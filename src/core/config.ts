import path from "node:path";
import fsp from "node:fs/promises";
import { CliError } from "./errors.ts";
import { assertSchema } from "./schema.ts";
import { actualPath, atomicWriteFile, isInsidePath, safeJoin, expandHome } from "./fsx.ts";

export const CONFIG_FILE_NAME = "ship.config.json";

export interface SteamDepotConfig {
  id: number;
  source: string;
  exclusions?: string[];
}

export interface SteamConfig {
  appId: number;
  contentRoot: string;
  buildOutput: string;
  executable?: string;
  steamcmdPath?: string;
  depots: SteamDepotConfig[];
}

export interface WechatConfig {
  appid: string;
  projectPath: string;
  robot?: number;
  privateKeyPath?: string;
  ignores?: string[];
  setting?: {
    useProjectConfig?: boolean;
    es6?: boolean;
    es7?: boolean;
    minify?: boolean;
    minifyJS?: boolean;
    codeProtect?: boolean;
    autoPrefixWXSS?: boolean;
  };
  bigPackageSizeSupport?: boolean;
  timeoutMs?: number;
}

export interface LimitsConfig {
  wxMainBytes?: number;
  wxIndependentSubpackageBytes?: number;
  wxTotalBytes?: number;
}

export interface ShipConfig {
  schemaVersion: 1;
  name?: string;
  steam?: SteamConfig;
  wechat?: WechatConfig;
  limits?: LimitsConfig;
  /** Directory containing ship.config.json; every path in the config resolves against it. */
  projectRoot: string;
}

export const DEFAULT_WX_LIMITS = {
  wxMainBytes: 4 * 1024 * 1024,
  wxIndependentSubpackageBytes: 4 * 1024 * 1024,
  wxTotalBytes: 30 * 1024 * 1024,
} as const;

export const CONFIG_TEMPLATE = {
  schemaVersion: 1,
  name: "my-game",
  steam: {
    appId: 1000000,
    contentRoot: "build/steam",
    buildOutput: "build/steam-steamcmd-out",
    executable: "MyGame.exe",
    depots: [
      {
        id: 1000001,
        source: ".",
        exclusions: ["*.pdb", "*_BurstDebugInformation_*"],
      },
    ],
  },
  wechat: {
    appid: "wx0000000000000000",
    projectPath: "build/wx/minigame",
    robot: 1,
  },
} as const;

/** Search upward from `startDir` for ship.config.json; undefined when absent. */
export async function findConfigFile(
  startDir: string,
): Promise<string | undefined> {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, CONFIG_FILE_NAME);
    try {
      const stat = await fsp.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // not here, keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Load + schema-validate + cross-field-validate ship.config.json. */
export async function loadConfig(startDir: string): Promise<ShipConfig> {
  const file = await findConfigFile(startDir);
  if (file === undefined) {
    throw new CliError(
      "CFG_CONFIG_NOT_FOUND",
      `no ${CONFIG_FILE_NAME} found in or above ${path.resolve(startDir)}`,
    );
  }
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (err) {
    throw new CliError(
      "CFG_CONFIG_INVALID_JSON",
      `cannot read ${file}: ${String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CliError(
      "CFG_CONFIG_INVALID_JSON",
      `${file} is not valid JSON: ${String(err)}`,
    );
  }
  assertSchema(CONFIG_FILE_NAME, parsed, "ship-config.schema.json");

  const doc = parsed as Omit<ShipConfig, "projectRoot">;
  const projectRoot = path.dirname(file);
  const config: ShipConfig = { ...doc, projectRoot };
  if (config.steam?.steamcmdPath !== undefined) config.steam.steamcmdPath = path.resolve(projectRoot, expandHome(config.steam.steamcmdPath));

  if (config.steam === undefined && config.wechat === undefined) {
    throw new CliError(
      "CFG_SCHEMA_INVALID",
      `${file}: at least one of "steam" or "wechat" must be configured`,
    );
  }
  if (config.steam !== undefined) validateSteamCrossFields(config.steam, file);
  if (config.wechat !== undefined)
    safeJoin(projectRoot, config.wechat.projectPath);
  return config;
}

function validateSteamCrossFields(steam: SteamConfig, file: string): void {
  const projectRoot = path.dirname(file);
  const contentRoot = safeJoin(projectRoot, steam.contentRoot);
  const buildOutput = safeJoin(projectRoot, steam.buildOutput);
  if (steam.executable !== undefined) safeJoin(contentRoot, steam.executable);
  const ids = new Set<number>();
  for (const depot of steam.depots) {
    if (ids.has(depot.id)) {
      throw new CliError(
        "CFG_DEPOT_DUPLICATE_ID",
        `${file}: duplicate depot id ${depot.id}`,
      );
    }
    ids.add(depot.id);
    if (depot.source !== ".") {
      const resolved = safeJoin(contentRoot, depot.source);
      if (!isInsidePath(actualPath(contentRoot), actualPath(resolved))) {
        throw new CliError(
          "CFG_DEPOT_SOURCE_OUTSIDE_CONTENT_ROOT",
          `${file}: depot ${depot.id} source "${depot.source}" resolves outside contentRoot`,
        );
      }
    }
  }
  const buildOutputAbs = actualPath(buildOutput);
  const contentRootAbs = actualPath(contentRoot);
  if (isInsidePath(contentRootAbs, buildOutputAbs)) {
    throw new CliError(
      "CFG_CONFIG_PATH_CONFLICT",
      `${file}: buildOutput must not be inside contentRoot (steamcmd requirement; chunk cache would be uploaded)`,
    );
  }
  if (isInsidePath(buildOutputAbs, contentRootAbs)) {
    throw new CliError(
      "CFG_CONFIG_PATH_CONFLICT",
      `${file}: contentRoot must not be inside buildOutput (BuildOutput holds logs/cache, not content)`,
    );
  }
}

/** Resolve a config-relative path with `..` escape protection. */
export function resolveFromProject(
  config: ShipConfig,
  relative: string,
): string {
  return safeJoin(config.projectRoot, relative);
}

export async function writeConfigTemplate(
  target: string,
  force: boolean,
): Promise<void> {
  const exists = await fsp.stat(target).then(
    () => true,
    () => false,
  );
  if (exists && !force) {
    throw new CliError(
      "CFG_CONFIG_EXISTS",
      `${target} already exists (use --force to overwrite)`,
    );
  }
  await atomicWriteFile(
    target,
    `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`,
  );
}
