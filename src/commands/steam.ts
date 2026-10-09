import fsp from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { CliError } from "../core/errors.ts";
import {
  loadConfig,
  resolveFromProject,
  type ShipConfig,
  type SteamConfig,
} from "../core/config.ts";
import { log } from "../core/logger.ts";
import {
  atomicWriteFile,
  isDirectory,
  isFile,
  openUrl,
  safeJoin,
} from "../core/fsx.ts";
import {
  appBuildVdfName,
  depotBuildVdfName,
  renderAppBuildVdf,
  renderDepotBuildVdf,
} from "../steam/vdf.ts";
import {
  buildLoginArgs,
  findSteamcmd,
  resolveSteamCredentials,
  runSteamcmdBuild,
  seedConfigVdf,
  steamBuildsUrl,
} from "../steam/steamcmd.ts";
import { analyzeSteamcmdOutput } from "../steam/logparse.ts";

function requireSteam(config: ShipConfig): SteamConfig {
  if (config.steam === undefined) {
    throw new CliError(
      "CFG_SCHEMA_INVALID",
      "ship.config.json has no steam section",
    );
  }
  return config.steam;
}

function normalizeBranch(branch: string | undefined): string {
  if (branch === undefined) return "";
  const trimmed = branch.trim();
  if (trimmed === "") {
    throw new CliError(
      "STM_SETLIVE_EMPTY_BRANCH",
      "--set-live must be a non-empty branch name when provided",
    );
  }
  if (trimmed.toLowerCase() === "default") {
    throw new CliError(
      "STM_SETLIVE_DEFAULT",
      `Steam forbids setting the default branch live automatically; set it manually in App Admin -> Builds (requires phone-verified build account for released apps)`,
    );
  }
  return trimmed;
}

export interface PreparedVdfs {
  vdfDir: string;
  appBuildPath: string;
  depotPaths: Array<{ id: number; path: string }>;
  contentRoot: string;
  buildOutput: string;
  setLive: string;
  preview: boolean;
}

/** Generate + atomically write app_build and depot_build VDFs under <buildOutput>/vdf. */
export async function prepareSteamVdfs(
  config: ShipConfig,
  opts: { desc: string; setLive?: string; preview: boolean },
): Promise<PreparedVdfs> {
  const steam = requireSteam(config);
  const setLive = normalizeBranch(opts.setLive);
  const contentRoot = resolveFromProject(config, steam.contentRoot);
  const buildOutput = resolveFromProject(config, steam.buildOutput);
  const vdfDir = path.join(buildOutput, "vdf");

  const depotNames = steam.depots.map((depot) => ({
    id: depot.id,
    vdf: depotBuildVdfName(depot.id),
  }));
  const appBuild = renderAppBuildVdf({
    appId: steam.appId,
    desc: opts.desc,
    contentRoot,
    buildOutput,
    setLive,
    preview: opts.preview,
    depots: depotNames,
  });
  const appBuildPath = path.join(vdfDir, appBuildVdfName(steam.appId));
  await atomicWriteFile(appBuildPath, appBuild);

  const depotPaths: PreparedVdfs["depotPaths"] = [];
  for (const depot of steam.depots) {
    const content = renderDepotBuildVdf({
      depotId: depot.id,
      source: depot.source,
      exclusions: depot.exclusions ?? [],
    });
    const depotPath = path.join(vdfDir, depotBuildVdfName(depot.id));
    await atomicWriteFile(depotPath, content);
    depotPaths.push({ id: depot.id, path: depotPath });
  }
  return {
    vdfDir,
    appBuildPath,
    depotPaths,
    contentRoot,
    buildOutput,
    setLive,
    preview: opts.preview,
  };
}

export async function runSteamVdf(
  startDir: string,
  opts: { desc: string; setLive?: string; preview: boolean; json: boolean },
): Promise<void> {
  const config = await loadConfig(startDir);
  const prepared = await prepareSteamVdfs(config, opts);
  if (opts.json) {
    log.result({
      appBuild: prepared.appBuildPath,
      depots: prepared.depotPaths,
      setLive: prepared.setLive,
      preview: prepared.preview,
    });
    return;
  }
  log.info(`wrote ${prepared.appBuildPath}`);
  for (const depot of prepared.depotPaths) {
    log.info(`wrote ${depot.path} (depot ${depot.id})`);
  }
  log.info(
    `preview=${prepared.preview ? "1 (dry-run, uploads nothing)" : "0 (real build)"}  setLive="${prepared.setLive}"`,
  );
}

export interface SteamPushOptions {
  desc: string;
  setLive?: string;
  preview: boolean;
  json: boolean;
}

export async function runSteamBuild(
  startDir: string,
  opts: SteamPushOptions,
): Promise<void> {
  const config = await loadConfig(startDir);
  const steam = requireSteam(config);
  const creds = resolveSteamCredentials(process.env);
  const loginArgs = buildLoginArgs(creds);
  const steamcmdExe = await findSteamcmd(process.env, steam.steamcmdPath);
  if (steamcmdExe === undefined) {
    throw new CliError(
      "STM_STEAMCMD_NOT_FOUND",
      "steamcmd not found; download https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip, then set SHIP_STEAMCMD or steam.steamcmdPath",
    );
  }
  const prepared = await prepareSteamVdfs(config, opts);
  if (!(await isDirectory(prepared.contentRoot))) {
    throw new CliError(
      "STM_CONTENT_ROOT_MISSING",
      `contentRoot does not exist: ${prepared.contentRoot}`,
    );
  }
  await inspectSteamContent(prepared.contentRoot);
  if (creds.configVdf !== undefined) {
    await seedConfigVdf(steamcmdExe, creds.configVdf);
  }
  await fsp.mkdir(path.join(prepared.buildOutput, "logs"), { recursive: true });

  const mode = opts.preview ? "preview (no upload)" : "build";
  if (!opts.json) {
    log.info(`steamcmd: ${steamcmdExe}`);
    log.info(
      `mode: ${mode}  app ${steam.appId}  setLive "${prepared.setLive || "(none)"}"`,
    );
    log.info(`content: ${prepared.contentRoot}`);
  }
  const secrets = [creds.password, creds.totp, creds.totpSecret].filter(
    (s): s is string => s !== undefined,
  );
  const run = await runSteamcmdBuild(
    {
      steamcmdExe,
      loginArgs,
      appBuildVdf: prepared.appBuildPath,
      buildOutputDir: prepared.buildOutput,
    },
    secrets,
  );
  const outcome = analyzeSteamcmdOutput(run.combinedOutput, "", run.exitCode, {
    appId: steam.appId,
    preview: opts.preview,
  });

  if (outcome.status !== "success") {
    const code =
      outcome.status === "failed"
        ? "STM_BUILD_FAILED"
        : "STM_BUILD_UNKNOWN_OUTCOME";
    throw new CliError(
      code,
      `steamcmd ${mode} did not succeed (exit ${run.exitCode})`,
      {
        exitCode: 3,
        details: {
          errors: outcome.errors,
          hints: outcome.hints,
          logPath: run.logPath,
        },
      },
    );
  }
  if (opts.json) {
    log.result({
      ok: true,
      mode,
      appId: steam.appId,
      buildId: outcome.buildId ?? null,
      setLive: prepared.setLive || null,
      logPath: run.logPath,
      vdfDir: prepared.vdfDir,
    });
    return;
  }
  log.info(
    `success${outcome.buildId !== undefined ? ` (build ${outcome.buildId})` : ""}`,
  );
  log.info(`full log: ${run.logPath}`);
  if (prepared.setLive !== "") {
    log.info(
      `build is live on branch "${prepared.setLive}"; test with: steam://run/${steam.appId}`,
    );
  } else {
    log.info(
      `next: set the build live on a branch in App Admin -> Builds: ${steamBuildsUrl(steam.appId)}`,
    );
  }
}

export async function runSteamTest(
  startDir: string,
  opts: { writeAppid: boolean; json: boolean },
): Promise<void> {
  const config = await loadConfig(startDir);
  const steam = requireSteam(config);
  const contentRoot = resolveFromProject(config, steam.contentRoot);
  const appidFile = path.join(contentRoot, "steam_appid.txt");

  if (!(await isDirectory(contentRoot))) {
    throw new CliError(
      "STM_CONTENT_ROOT_MISSING",
      `contentRoot does not exist: ${contentRoot}`,
    );
  }

  let appidState: "present" | "written" | "missing" = "missing";
  if (await isFile(appidFile)) {
    appidState = "present";
    const content = (await fsp.readFile(appidFile, "utf8")).trim();
    if (content !== String(steam.appId)) {
      throw new CliError(
        "STM_APPID_FILE_MISMATCH",
        `steam_appid.txt contains "${content}" but config appId is ${steam.appId}`,
      );
    }
  } else if (opts.writeAppid) {
    await atomicWriteFile(appidFile, `${steam.appId}\n`);
    appidState = "written";
  }

  const libraries = await inspectSteamContent(contentRoot);
  const apiDllFound = libraries.length > 0;
  const executable =
    steam.executable === undefined
      ? undefined
      : safeJoin(contentRoot, steam.executable);
  const executableOk =
    executable === undefined ? null : await isFile(executable);

  const summary = {
    ok: appidState !== "missing" && apiDllFound && executableOk !== false,
    contentRoot,
    steamAppidTxt: appidState,
    steamApiDllFound: apiDllFound,
    steamApiLibraries: libraries,
    executable:
      executable === null || executable === undefined
        ? null
        : { path: executable, exists: executableOk === true },
    runUrl: `steam://run/${steam.appId}`,
    buildsUrl: steamBuildsUrl(steam.appId),
  };
  if (!summary.ok)
    throw new CliError(
      executableOk === false
        ? "STM_EXECUTABLE_MISSING"
        : "STM_CONTENT_ROOT_MISSING",
      "local Steam prerequisites are incomplete (AppID file, Steam API library or configured executable)",
      { details: summary },
    );
  if (opts.json) {
    log.result(summary);
    return;
  }
  log.info(`content root: ${contentRoot}`);
  log.info(`steam_appid.txt: ${appidState}`);
  if (apiDllFound) {
    log.info("steam_api64.dll: found");
  } else {
    log.warn("steam_api64.dll: NOT found");
    log.warn(
      "  fix: copy steam_api64.dll from the Steamworks SDK redistributables next to the exe (required to run outside the Steam client)",
    );
  }
  if (executable !== undefined) {
    if (executableOk) {
      log.info(`executable: ${executable}`);
    } else {
      log.warn(`executable: ${executable} (missing)`);
      log.warn(
        "  fix: point steam.executable at the built exe (relative to contentRoot)",
      );
    }
  }
  log.info(
    `run locally from the build dir (needs a logged-in Steam client) or via ${summary.runUrl}`,
  );
  log.info(`manage builds: ${summary.buildsUrl}`);
  if (appidState === "missing") {
    log.warn(
      "steam_appid.txt missing; rerun with --write-appid to create it for local runs outside the Steam client",
    );
  }
}

async function inspectSteamContent(root: string): Promise<string[]> {
  const libraries: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink())
        throw new CliError(
          "PAT_ESCAPE",
          `Steam content must contain actual files, not links: ${path.join(current, entry.name)}`,
        );
      if (
        entry.isFile() &&
        /^(?:steam_api(?:64)?\.dll|libsteam_api\.(?:so|dylib))$/i.test(
          entry.name,
        )
      )
        libraries.push(path.join(current, entry.name));
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
    }
  }
  return libraries;
}

export async function runSteamOpen(
  startDir: string,
  target: string,
): Promise<void> {
  const config = await loadConfig(startDir);
  const steam = requireSteam(config);
  if (target === "builds") {
    await openUrl(steamBuildsUrl(steam.appId));
    return;
  }
  throw new CliError(
    "CFG_SCHEMA_INVALID",
    `unknown steam open target "${target}" (supported: builds)`,
  );
}

export function registerSteamCommand(program: Command): void {
  const steam = program
    .command("steam")
    .description("Steam packaging and upload via steamcmd / SteamPipe");

  steam
    .command("vdf")
    .description(
      "generate app_build + depot_build VDFs (inspect or hand-run them yourself)",
    )
    .option(
      "--desc <text>",
      "build description recorded on the Builds page",
      "ship-cli build",
    )
    .option(
      "--set-live <branch>",
      "branch to auto set live after upload (NOT allowed: default)",
    )
    .option(
      "--preview",
      "write Preview=1 (dry-run VDF, uploads nothing)",
      false,
    )
    .option("--json", "print JSON result")
    .action(
      async (options: {
        desc: string;
        setLive?: string;
        preview: boolean;
        json: boolean;
      }) => {
        await runSteamVdf(process.cwd(), options);
      },
    );

  const build = (cmd: Command, preview: boolean) => {
    cmd
      .option(
        "--desc <text>",
        "build description recorded on the Builds page",
        "ship-cli build",
      )
      .option("--json", "print JSON result");
    if (!preview) {
      cmd.option(
        "--set-live <branch>",
        "branch to auto set live after upload (NOT allowed: default)",
      );
    }
    return cmd;
  };

  build(
    steam
      .command("preview")
      .description(
        "run steamcmd with Preview=1: full pipeline, uploads NOTHING, produces logs + manifest",
      ),
    true,
  ).action(async (options: { desc: string; json: boolean }) => {
    await runSteamBuild(process.cwd(), {
      ...options,
      preview: true,
      setLive: undefined,
    });
  });

  build(
    steam
      .command("push")
      .description(
        "upload a real build via steamcmd (optionally set live on a NON-default branch)",
      ),
    false,
  ).action(
    async (options: { desc: string; setLive?: string; json: boolean }) => {
      await runSteamBuild(process.cwd(), { ...options, preview: false });
    },
  );

  steam
    .command("test")
    .description(
      "local smoke checks on the built content (steam_appid.txt, steam_api dll, run URLs)",
    )
    .option(
      "--write-appid",
      "create steam_appid.txt in contentRoot when missing",
      false,
    )
    .option("--json", "print JSON result")
    .action(async (options: { writeAppid: boolean; json: boolean }) => {
      await runSteamTest(process.cwd(), options);
    });

  steam
    .command("open <target>")
    .description("open a Steamworks partner page (builds)")
    .action(async (target: string) => {
      await runSteamOpen(process.cwd(), target);
    });
}
