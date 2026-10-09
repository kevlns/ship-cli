import path from "node:path";
import {
  loadConfig,
  findConfigFile,
  CONFIG_FILE_NAME,
} from "../core/config.ts";
import {
  findSteamcmd,
  resolveSteamCredentials,
  describeCredentialMode,
} from "../steam/steamcmd.ts";
import { resolveMiniprogramCi, resolvePrivateKey } from "../wx/cicli.ts";
import { isDirectory, isFile, actualPath, isInsidePath } from "../core/fsx.ts";
import { CliError } from "../core/errors.ts";
import { log } from "../core/logger.ts";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail" | "skip";
  detail: string;
}

export interface DoctorReport {
  node: string;
  platform: string;
  config: { found: boolean; path?: string };
  steam?: {
    configured: boolean;
    steamcmd?: { found: boolean; path?: string };
    credentials?: { mode: string; username: boolean; configVdfSeeded: boolean };
  };
  wechat?: {
    configured: boolean;
    projectDir?: { exists: boolean; path: string };
    privateKey?: { found: boolean; path?: string; error?: string };
    miniprogramCi?: { found: boolean; dir?: string };
  };
  checks: DoctorCheck[];
}

export async function runDoctor(startDir: string): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const report: DoctorReport = {
    node: process.version,
    platform: process.platform,
    config: { found: false },
    checks,
  };
  const configFile = await findConfigFile(startDir);
  report.config =
    configFile === undefined
      ? { found: false }
      : { found: true, path: configFile };

  const config =
    configFile === undefined ? undefined : await safeLoad(startDir);
  if (configFile === undefined) {
    checks.push({
      name: "config",
      status: "fail",
      detail: `no ${CONFIG_FILE_NAME} in or above ${startDir} (config init creates one)`,
    });
  } else if (config === undefined) {
    checks.push({
      name: "config",
      status: "fail",
      detail: `${configFile} failed to load; run: ship-cli config validate`,
    });
  } else {
    checks.push({ name: "config", status: "ok", detail: configFile });
  }

  if (config?.steam !== undefined) {
    const steamExe = await findSteamcmd(process.env, config.steam.steamcmdPath);
    report.steam = {
      configured: true,
      steamcmd:
        steamExe === undefined
          ? { found: false }
          : { found: true, path: steamExe },
    };
    if (steamExe === undefined) {
      checks.push({
        name: "steam:steamcmd",
        status: "fail",
        detail:
          "steamcmd not found; install from https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip and set SHIP_STEAMCMD or steam.steamcmdPath",
      });
    } else {
      checks.push({ name: "steam:steamcmd", status: "ok", detail: steamExe });
    }
    const creds = resolveSteamCredentials(process.env);
    const mode = describeCredentialMode(creds);
    report.steam.credentials = {
      mode,
      username: creds.username !== undefined,
      configVdfSeeded: creds.configVdf !== undefined,
    };
    if (creds.username === undefined) {
      checks.push({
        name: "steam:credentials",
        status: "fail",
        detail: "SHIP_STEAM_USERNAME unset; steam push will not run",
      });
    } else if (
      !creds.password &&
      !creds.configVdf &&
      (!steamExe ||
        !(await isFile(
          path.join(path.dirname(steamExe), "config", "config.vdf"),
        )))
    ) {
      checks.push({
        name: "steam:credentials",
        status: "fail",
        detail:
          "passwordless login requires an existing config/config.vdf or SHIP_STEAM_CONFIG_VDF",
      });
    } else {
      checks.push({ name: "steam:credentials", status: "ok", detail: mode });
    }
    const contentRoot = path.resolve(
      config.projectRoot,
      config.steam.contentRoot,
    );
    if (!(await isDirectory(contentRoot))) {
      checks.push({
        name: "steam:contentRoot",
        status: "fail",
        detail: `contentRoot does not exist yet: ${contentRoot}`,
      });
    } else {
      checks.push({
        name: "steam:contentRoot",
        status: "ok",
        detail: contentRoot,
      });
    }
  }

  if (config?.wechat !== undefined) {
    const projectPath = path.resolve(
      config.projectRoot,
      config.wechat.projectPath,
    );
    const exists = await isDirectory(projectPath);
    report.wechat = {
      configured: true,
      projectDir: { exists, path: projectPath },
    };
    checks.push({
      name: "wx:project",
      status: exists ? "ok" : "fail",
      detail: exists
        ? projectPath
        : `wechat projectPath does not exist yet: ${projectPath}`,
    });
    try {
      const key = await resolvePrivateKey(
        process.env,
        config.wechat.privateKeyPath,
        config.projectRoot,
      );
      if (isInsidePath(actualPath(projectPath),actualPath(key))) throw new CliError("WX_KEY_INVALID","upload private key must be outside packaged game content");
      report.wechat.privateKey = { found: true, path: key };
      checks.push({ name: "wx:key", status: "ok", detail: key });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.wechat.privateKey = { found: false, error: message };
      checks.push({ name: "wx:key", status: "fail", detail: message });
    }
    try {
      const ciDir = await resolveMiniprogramCi([
        projectPath,
        config.projectRoot,
      ]);
      report.wechat.miniprogramCi = { found: true, dir: ciDir };
      checks.push({ name: "wx:miniprogram-ci", status: "ok", detail: ciDir });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.wechat.miniprogramCi = { found: false };
      checks.push({
        name: "wx:miniprogram-ci",
        status: "fail",
        detail: message,
      });
    }
  }

  return report;
}

async function safeLoad(
  startDir: string,
): Promise<Awaited<ReturnType<typeof loadConfig>> | undefined> {
  try {
    return await loadConfig(startDir);
  } catch {
    return undefined;
  }
}

export function printDoctor(report: DoctorReport, json: boolean): void {
  if (json) {
    log.result({
      ...report,
      ok: !report.checks.some((check) => check.status === "fail"),
    });
    return;
  }
  log.info(`ship-cli doctor`);
  log.info(`  node ${report.node}  platform ${report.platform}`);
  for (const check of report.checks) {
    const icon =
      check.status === "ok"
        ? "[ok]"
        : check.status === "warn"
          ? "[!!]"
          : "[XX]";
    log.info(`  ${icon} ${check.name}: ${check.detail}`);
  }
}
