import fsp from "node:fs/promises";
import path from "node:path";
import { CliError } from "../core/errors.ts";
import { lookupOnPath, runProcess, type ProcessRunner } from "../core/exec.ts";
import {
  atomicWriteFile,
  expandHome,
  isFile,
  pathExists,
} from "../core/fsx.ts";
import { generateSteamTotp } from "./totp.ts";
import { redactSecrets } from "../core/redact.ts";
import { log } from "../core/logger.ts";

export interface SteamCredentials {
  username?: string;
  password?: string;
  /** Precomputed Steam Guard code (valid ~30s). */
  totp?: string;
  /** Shared secret; the code is generated at run time. Preferred for CI. */
  totpSecret?: string;
  /** base64-encoded steamcmd config/config.vdf carrying a logged-in Steam Guard token. */
  configVdf?: string;
}

function pick(env: NodeJS.ProcessEnv, suffix: string): string | undefined {
  const prefixed = env[`SHIP_STEAM_${suffix}`];
  if (prefixed !== undefined && prefixed !== "") return prefixed;
  return undefined;
}

/** Only the namespaced SHIP_STEAM_* variables configure credentials. */
export function resolveSteamCredentials(
  env: NodeJS.ProcessEnv,
): SteamCredentials {
  return {
    username: pick(env, "USERNAME"),
    password: pick(env, "PASSWORD"),
    totp: pick(env, "TOTP"),
    totpSecret: pick(env, "TOTP_SECRET"),
    configVdf: pick(env, "CONFIG_VDF"),
  };
}

export function describeCredentialMode(creds: SteamCredentials): string {
  if (
    creds.password !== undefined &&
    (creds.totp !== undefined || creds.totpSecret !== undefined)
  ) {
    return "password + TOTP";
  }
  if (creds.password !== undefined) {
    return "password only (first login may require a Steam Guard code)";
  }
  return "passwordless (requires a valid config.vdf next to steamcmd)";
}

/** Build the `+login` argument list; refuses unset usernames. */
export function buildLoginArgs(
  creds: SteamCredentials,
  nowSeconds = Math.floor(Date.now() / 1000),
): string[] {
  if (creds.username === undefined || creds.username === "") {
    throw new CliError(
      "STM_NO_USERNAME",
      "Steam build account username missing: set SHIP_STEAM_USERNAME",
    );
  }
  if (creds.password === undefined || creds.password === "") {
    return ["+login", creds.username];
  }
  const code =
    creds.totp ??
    (creds.totpSecret !== undefined
      ? generateSteamTotp(creds.totpSecret, nowSeconds)
      : undefined);
  if (code !== undefined) {
    return ["+login", creds.username, creds.password, code];
  }
  return ["+login", creds.username, creds.password];
}

const COMMON_STEAMCMD_DIRS = ["~/steamcmd", "C:/steamcmd", "D:/steamcmd"];

/** Locate steamcmd: env override > config path > PATH > common install dirs. */
export async function findSteamcmd(
  env: NodeJS.ProcessEnv,
  configPath?: string,
): Promise<string | undefined> {
  const candidates: string[] = [];
  const fromEnv = env.SHIP_STEAMCMD;
  const explicit = fromEnv || configPath;
  if (explicit)
    return (await isFile(expandHome(explicit)))
      ? path.resolve(expandHome(explicit))
      : undefined;
  const onPath = await lookupOnPath("steamcmd");
  if (onPath) return onPath;
  for (const dir of COMMON_STEAMCMD_DIRS) {
    if (process.platform !== "win32") candidates.push(path.join(expandHome(dir), "steamcmd.sh"));
    candidates.push(
      path.join(
        expandHome(dir),
        process.platform === "win32" ? "steamcmd.exe" : "steamcmd",
      ),
    );
  }
  for (const candidate of candidates) {
    const expanded = expandHome(candidate);
    if (await isFile(expanded)) return path.resolve(expanded);
  }
  return undefined;
}

/**
 * Seed <steamcmd dir>/config/config.vdf from a base64 payload so a passwordless
 * `+login <user>` works in CI. Refuses to overwrite a differing existing file.
 */
export async function seedConfigVdf(
  steamcmdExe: string,
  base64Payload: string,
): Promise<string> {
  let decoded: string;
  try {
    decoded = Buffer.from(base64Payload, "base64").toString("utf8");
  } catch {
    throw new CliError(
      "STM_CONFIG_VDF_INVALID",
      "SHIP_STEAM_CONFIG_VDF is not valid base64",
    );
  }
  if (!decoded.includes("InstallConfigStore")) {
    throw new CliError(
      "STM_CONFIG_VDF_INVALID",
      "SHIP_STEAM_CONFIG_VDF payload does not look like a steamcmd config.vdf (missing InstallConfigStore)",
    );
  }
  const target = path.join(
    path.dirname(path.resolve(steamcmdExe)),
    "config",
    "config.vdf",
  );
  if (await pathExists(target)) {
    const existing = await fsp.readFile(target, "utf8");
    if (existing === decoded) return target;
    throw new CliError(
      "STM_CONFIG_VDF_CONFLICT",
      `${target} already exists and differs from SHIP_STEAM_CONFIG_VDF; remove it (or re-export a fresh config.vdf) before seeding. ` +
        "Remember: logging in with a password again invalidates the old token.",
    );
  }
  await atomicWriteFile(target, decoded);
  return target;
}

export interface SteamRunInput {
  steamcmdExe: string;
  loginArgs: string[];
  appBuildVdf: string;
  buildOutputDir: string;
  /** Extra env for the child process. */
  env?: NodeJS.ProcessEnv;
  run?: ProcessRunner;
}

export interface SteamRunResult {
  exitCode: number;
  logPath: string;
  combinedOutput: string;
}

/** Run steamcmd for a build; always persists a redacted full log under BuildOutput/logs. */
export async function runSteamcmdBuild(
  input: SteamRunInput,
  secrets: string[],
): Promise<SteamRunResult> {
  const args = [
    ...input.loginArgs,
    "+run_app_build",
    input.appBuildVdf,
    "+quit",
  ];
  const run = input.run ?? runProcess;
  const logsDir = path.join(input.buildOutputDir, "logs");
  await fsp.mkdir(logsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(logsDir, `steamcmd-${stamp}.log`);

  const effectiveSecrets = [...secrets, ...input.loginArgs.slice(2)];
  let result;
  try {
    result = await run(input.steamcmdExe, args, {
      env: input.env,
      redact: effectiveSecrets,
      timeoutMs: 60 * 60 * 1000,
      onLine: (line) => {
        if (!log.json) log.info(line);
      },
    });
  } catch (err) {
    const error = err as CliError;
    await atomicWriteFile(
      logPath,
      redactSecrets(
        JSON.stringify({ message: error.message, details: error.details }),
        effectiveSecrets,
      ),
    );
    throw new CliError(
      "STM_BUILD_FAILED",
      redactSecrets(error.message, effectiveSecrets),
      { details: { logPath } },
    );
  }
  const combined = redactSecrets(
    `${result.stdout}\n${result.stderr}`,
    effectiveSecrets,
  );
  await atomicWriteFile(
    logPath,
    combined.endsWith("\n") ? combined : `${combined}\n`,
  );
  return { exitCode: result.code, logPath, combinedOutput: combined };
}

export function steamBuildsUrl(appId: number): string {
  return `https://partner.steamgames.com/apps/builds/${appId}`;
}
