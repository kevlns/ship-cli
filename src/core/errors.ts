import { suggest } from "./suggest.ts";

/**
 * Stable error taxonomy. Codes are part of the CLI contract (documented in
 * v-cli.plugin.json); never renumber exit codes.
 *
 * exitCode: 0 ok; 1 config/validation rejection; 2 missing prerequisite
 * (steamcmd, miniprogram-ci, key files); 3 steamcmd run failed; 4
 * miniprogram-ci run failed.
 */
export type ShipErrorCode =
  | "CLI_ARGUMENT_INVALID"
  | "PROCESS_START_FAILED"
  | "PROCESS_TIMEOUT"
  | "WX_PROJECT_CONFIG_INVALID"
  | "WX_CONTENT_UNREADABLE"
  | "WX_WORKERS_INVALID"
  | "WX_CI_VERSION_UNSUPPORTED"
  // config
  | "CFG_CONFIG_NOT_FOUND"
  | "CFG_CONFIG_INVALID_JSON"
  | "CFG_CONFIG_EXISTS"
  | "CFG_CONFIG_PATH_CONFLICT"
  | "CFG_DEPOT_SOURCE_OUTSIDE_CONTENT_ROOT"
  | "CFG_DEPOT_DUPLICATE_ID"
  | "CFG_SCHEMA_INVALID"
  // path safety
  | "PAT_ESCAPE"
  // steam
  | "STM_STEAMCMD_NOT_FOUND"
  | "STM_NO_USERNAME"
  | "STM_SETLIVE_DEFAULT"
  | "STM_SETLIVE_EMPTY_BRANCH"
  | "STM_CONFIG_VDF_INVALID"
  | "STM_CONFIG_VDF_CONFLICT"
  | "STM_TOTP_INVALID"
  | "STM_BUILD_FAILED"
  | "STM_BUILD_UNKNOWN_OUTCOME"
  | "STM_LOGIN_GUARD_REQUIRED"
  | "STM_CONTENT_ROOT_MISSING"
  | "STM_EXECUTABLE_MISSING"
  | "STM_APPID_FILE_MISMATCH"
  // wechat
  | "WX_PROJECT_DIR_MISSING"
  | "WX_GAME_JSON_MISSING"
  | "WX_GAME_JSON_INVALID"
  | "WX_GAME_ENTRY_MISSING"
  | "WX_PROJECT_CONFIG_MISSING"
  | "WX_SUBPACKAGE_ROOT_MISSING"
  | "WX_SUBPACKAGE_ROOT_OUTSIDE"
  | "WX_SUBPACKAGE_NESTED"
  | "WX_SUBPACKAGE_OVERLAPS_OPEN_DATA"
  | "WX_MAIN_OVER_LIMIT"
  | "WX_INDEPENDENT_OVER_LIMIT"
  | "WX_TOTAL_OVER_LIMIT"
  | "WX_KEY_NOT_FOUND"
  | "WX_KEY_INVALID"
  | "WX_CI_NOT_INSTALLED"
  | "WX_UPLOAD_FAILED"
  | "WX_PREVIEW_FAILED"
  | "WX_VALIDATION_FAILED"
  | "WX_VERSION_REQUIRED";

export class CliError extends Error {
  readonly code: ShipErrorCode;
  readonly exitCode: number;
  readonly details?: unknown;
  /** Remediation line, auto-filled from the suggestion registry when omitted. */
  readonly suggestion?: string;
  readonly docs?: string;

  constructor(
    code: ShipErrorCode,
    message: string,
    options?: {
      exitCode?: number;
      details?: unknown;
      suggestion?: string;
      docs?: string;
    },
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = options?.exitCode ?? exitCodeFor(code);
    this.details = options?.details;
    const fix = suggest(code);
    this.suggestion = options?.suggestion ?? fix.suggestion;
    this.docs = options?.docs ?? fix.docs;
  }
}

/** Validation rejections (config/content violations) — exit 1. */
const VALIDATION_REJECT = new Set<ShipErrorCode>([
  "WX_VALIDATION_FAILED",
  "WX_PROJECT_DIR_MISSING",
  "WX_GAME_JSON_MISSING",
  "WX_GAME_JSON_INVALID",
  "WX_GAME_ENTRY_MISSING",
  "WX_PROJECT_CONFIG_MISSING",
  "WX_SUBPACKAGE_ROOT_MISSING",
  "WX_SUBPACKAGE_ROOT_OUTSIDE",
  "WX_SUBPACKAGE_NESTED",
  "WX_SUBPACKAGE_OVERLAPS_OPEN_DATA",
  "WX_MAIN_OVER_LIMIT",
  "WX_INDEPENDENT_OVER_LIMIT",
  "WX_TOTAL_OVER_LIMIT",
]);

/** Missing prerequisites (steamcmd, credentials, keys, miniprogram-ci) — exit 2. */
const PREREQUISITE = new Set<ShipErrorCode>([
  "STM_STEAMCMD_NOT_FOUND",
  "STM_NO_USERNAME",
  "STM_SETLIVE_EMPTY_BRANCH",
  "STM_CONFIG_VDF_INVALID",
  "STM_CONFIG_VDF_CONFLICT",
  "STM_TOTP_INVALID",
  "STM_CONTENT_ROOT_MISSING",
  "STM_EXECUTABLE_MISSING",
  "WX_KEY_NOT_FOUND",
  "WX_KEY_INVALID",
  "WX_CI_NOT_INSTALLED",
  "WX_CI_VERSION_UNSUPPORTED",
]);

/** External tool run failures — exit 3 (steamcmd) / 4 (miniprogram-ci). */
const STEAM_RUN_FAILED = new Set<ShipErrorCode>([
  "STM_BUILD_FAILED",
  "STM_BUILD_UNKNOWN_OUTCOME",
  "STM_LOGIN_GUARD_REQUIRED",
]);
const WX_RUN_FAILED = new Set<ShipErrorCode>([
  "WX_UPLOAD_FAILED",
  "WX_PREVIEW_FAILED",
]);

export function exitCodeFor(code: ShipErrorCode): number {
  if (STEAM_RUN_FAILED.has(code)) return 3;
  if (WX_RUN_FAILED.has(code)) return 4;
  if (VALIDATION_REJECT.has(code)) return 1;
  if (PREREQUISITE.has(code)) return 2;
  // STM_SETLIVE_DEFAULT and everything else: hard refusal / generic rejection
  return 1;
}
