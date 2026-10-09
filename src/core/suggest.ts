import type { ShipErrorCode } from "./errors.ts";

export interface FixSuggestion {
  /** One actionable remediation step (single line, starts with a verb). */
  suggestion: string;
  /** Official documentation backing the rule, when available. */
  docs?: string;
}

/**
 * Curated fix suggestions for every error code. The registry must cover the
 * whole ShipErrorCode union — enforced by tests/suggest.test.ts, so a new code
 * cannot ship without a remediation line.
 */
export const SUGGESTIONS: Record<ShipErrorCode, FixSuggestion> = {
  CLI_ARGUMENT_INVALID: {
    suggestion:
      "check the command and arguments with ship-cli <command> --help",
  },
  PROCESS_START_FAILED: {
    suggestion: "check that the executable exists and can run on this platform",
  },
  PROCESS_TIMEOUT: {
    suggestion:
      "check connectivity and external-tool logs; retry after resolving the timeout",
  },
  WX_PROJECT_CONFIG_INVALID: {
    suggestion:
      "fix project.config.json syntax, compileType=game and the configured AppID",
  },
  WX_CONTENT_UNREADABLE: {
    suggestion:
      "make every packaged file readable and replace directory links with actual build content",
  },
  WX_WORKERS_INVALID: {
    suggestion:
      "use a valid project-relative workers directory and avoid overlap with other subpackages",
  },
  WX_CI_VERSION_UNSUPPORTED: {
    suggestion: "install the supported SDK: npm i -D miniprogram-ci@2.1.31",
  },
  CFG_CONFIG_NOT_FOUND: {
    suggestion:
      "run `ship-cli config init` in the game repo (config is searched upward from cwd; use --project <dir> to point elsewhere)",
  },
  CFG_CONFIG_INVALID_JSON: {
    suggestion:
      "fix the JSON syntax and validate against schemas/ship-config.schema.json; compare with the template via `ship-cli config init` in a scratch dir",
  },
  CFG_CONFIG_EXISTS: {
    suggestion:
      "edit the existing ship.config.json instead, or pass --force to overwrite it deliberately",
  },
  CFG_CONFIG_PATH_CONFLICT: {
    suggestion:
      "point steam.buildOutput and steam.contentRoot at separate directories — steamcmd writes chunk cache (.csm/.csd) into BuildOutput and must never upload it",
    docs: "https://partner.steamgames.com/doc/sdk/uploading",
  },
  CFG_DEPOT_SOURCE_OUTSIDE_CONTENT_ROOT: {
    suggestion:
      'make each depot source a subdirectory of steam.contentRoot (use "." for the whole contentRoot)',
  },
  CFG_DEPOT_DUPLICATE_ID: {
    suggestion:
      "give every depot a unique id; the convention is appId+1, appId+2, ... for base app depots",
    docs: "https://partner.steamgames.com/doc/store/application/depots",
  },
  CFG_SCHEMA_INVALID: {
    suggestion:
      "fix the listed fields against schemas/ship-config.schema.json (template: `ship-cli config init` in a scratch dir)",
  },
  PAT_ESCAPE: {
    suggestion:
      "a configured path escaped its allowed base — remove absolute paths and '..' segments from path fields in ship.config.json",
  },
  STM_STEAMCMD_NOT_FOUND: {
    suggestion:
      "download https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip into its own directory, then set SHIP_STEAMCMD or steam.steamcmdPath",
    docs: "https://developer.valvesoftware.com/wiki/SteamCMD",
  },
  STM_NO_USERNAME: {
    suggestion: "export SHIP_STEAM_USERNAME for the dedicated build account",
  },
  STM_SETLIVE_DEFAULT: {
    suggestion:
      "Valve forbids auto set-live on default; push with --set-live <beta-branch> for testing, then set default live manually in App Admin -> Builds (`ship-cli steam open builds`)",
    docs: "https://partner.steamgames.com/doc/store/application/branches",
  },
  STM_SETLIVE_EMPTY_BRANCH: {
    suggestion:
      "pass a real branch name (e.g. beta) or omit --set-live entirely",
  },
  STM_CONFIG_VDF_INVALID: {
    suggestion:
      "SHIP_STEAM_CONFIG_VDF must be base64 of a steamcmd config/config.vdf containing InstallConfigStore; re-export it right after one successful interactive login",
  },
  STM_CONFIG_VDF_CONFLICT: {
    suggestion:
      "the steamcmd dir already holds a different config.vdf — remove it (or re-export a fresh one); note: logging in with a password again invalidates the old token",
    docs: "https://partner.steamgames.com/doc/sdk/uploading",
  },
  STM_TOTP_INVALID: {
    suggestion:
      "SHIP_STEAM_TOTP_SECRET must be the base64 shared secret of the build account's Steam Guard mobile authenticator",
  },
  STM_BUILD_FAILED: {
    suggestion:
      "inspect the logged ERROR lines and the saved log; common causes: backend config not saved yet, build account lacks Edit App Metadata, or corrupted chunk cache (delete the depot's .csm/.csd under BuildOutput and retry)",
    docs: "https://partner.steamgames.com/doc/sdk/uploading",
  },
  STM_BUILD_UNKNOWN_OUTCOME: {
    suggestion:
      "steamcmd exited 0 without a success signature, so it is treated as failed (fail-closed); open the saved log and check whether a build actually appeared in App Admin -> Builds",
  },
  STM_LOGIN_GUARD_REQUIRED: {
    suggestion:
      "first logins need a Steam Guard code: set SHIP_STEAM_TOTP / SHIP_STEAM_TOTP_SECRET, or log in once interactively and seed config.vdf via SHIP_STEAM_CONFIG_VDF",
    docs: "https://partner.steamgames.com/doc/sdk/uploading",
  },
  STM_CONTENT_ROOT_MISSING: {
    suggestion:
      "build the game player first, or fix steam.contentRoot in ship.config.json to point at the built output directory",
  },
  STM_EXECUTABLE_MISSING: {
    suggestion:
      "fix steam.executable (relative to contentRoot) so `steam test` can find the main exe",
  },
  STM_APPID_FILE_MISMATCH: {
    suggestion:
      "steam_appid.txt disagrees with steam.appId — fix one of them (`ship-cli steam test --write-appid` rewrites the file from config)",
  },
  WX_PROJECT_DIR_MISSING: {
    suggestion:
      "wechat.projectPath must be the converted mini game directory (the one containing game.json); run the engine convertor or fix the path",
  },
  WX_GAME_JSON_MISSING: {
    suggestion:
      "game.json must exist in wechat.projectPath — re-run the engine convertor or create it (deviceOrientation + subpackages)",
  },
  WX_GAME_JSON_INVALID: {
    suggestion:
      "fix game.json: subpackages entries need exactly name + root (roots must be safe relative paths; no duplicates); openDataContext must be a string path",
    docs: "https://developers.weixin.qq.com/minigame/dev/reference/configuration/app.html",
  },
  WX_GAME_ENTRY_MISSING: {
    suggestion:
      "the main package needs game.js at the project root — engine convertor output normally provides it; do not hand-create an empty one without real bootstrap code",
  },
  WX_PROJECT_CONFIG_MISSING: {
    suggestion:
      'create a minimal project.config.json in the project dir, e.g. {"appid":"<appid>","compileType":"game","libVersion":"latest"} — the Unity convertor normally emits it (miniprogram-ci requires it)',
    docs: "https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html",
  },
  WX_SUBPACKAGE_ROOT_MISSING: {
    suggestion:
      "create the subpackage directory with a game.js entry inside, or fix the root path in game.json — do not create an empty dir just to silence this check",
  },
  WX_SUBPACKAGE_ROOT_OUTSIDE: {
    suggestion:
      "subpackage roots must stay inside the mini game project directory",
  },
  WX_SUBPACKAGE_NESTED: {
    suggestion:
      "subpackage roots must not contain each other — keep them as sibling directories under the project root",
  },
  WX_SUBPACKAGE_OVERLAPS_OPEN_DATA: {
    suggestion:
      "the openDataContext directory cannot be a subpackage or live inside one (official rule) — move it outside all subpackage roots",
    docs: "https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html",
  },
  WX_MAIN_OVER_LIMIT: {
    suggestion:
      "move code/assets into subpackages (wx.loadSubpackage) or serve them from CDN — see the largest-files list for candidates; these are source estimates; configure compilation through wechat.setting and compare SDK package sizes",
    docs: "https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html",
  },
  WX_INDEPENDENT_OVER_LIMIT: {
    suggestion:
      "independent subpackages are capped at 4M each — slim it down, or make it a normal subpackage if it does not need to start without the main package",
    docs: "https://developers.weixin.qq.com/minigame/dev/guide/base-ability/independent-sub-packages.html",
  },
  WX_TOTAL_OVER_LIMIT: {
    suggestion:
      "total package is capped at 30M — move engine assets to CDN (the Unity convertor's webgl/ output belongs on CDN, not in the package)",
    docs: "https://developers.weixin.qq.com/minigame/dev/guide/base-ability/code-package.html",
  },
  WX_KEY_NOT_FOUND: {
    suggestion:
      "download the code-upload key at MP backend -> 管理 -> 开发管理 -> 开发设置 -> 小程序代码上传, then point SHIP_WX_PRIVATE_KEY (or wechat.privateKeyPath) at the file",
    docs: "https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html",
  },
  WX_KEY_INVALID: {
    suggestion:
      "the file must be the PEM private key downloaded from the MP backend (keys cannot be re-downloaded; reset if lost)",
  },
  WX_CI_NOT_INSTALLED: {
    suggestion:
      "install it in the game project: npm i -D miniprogram-ci (ship-cli resolves it from the project's node_modules)",
    docs: "https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html",
  },
  WX_UPLOAD_FAILED: {
    suggestion:
      "read the miniprogram-ci error output above; common causes: IP whitelist not configured, key was reset, package rejected by the compiler",
  },
  WX_PREVIEW_FAILED: {
    suggestion:
      "read the miniprogram-ci output and check wechat.bigPackageSizeSupport for preview-only size support",
  },
  WX_VALIDATION_FAILED: {
    suggestion:
      "fix every WX_* item in the report above, then re-run `ship-cli wx validate`",
  },
  WX_VERSION_REQUIRED: {
    suggestion:
      "pass --version <x.y.z>; it becomes the dev-version number shown in the MP backend",
  },
};

export function suggest(code: ShipErrorCode): FixSuggestion {
  return SUGGESTIONS[code];
}
