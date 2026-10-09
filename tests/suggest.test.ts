import { describe, expect, it } from "vitest";
import { SUGGESTIONS, suggest } from "../src/core/suggest.ts";
import { CliError, type ShipErrorCode } from "../src/core/errors.ts";

const ALL_CODES: ShipErrorCode[] = [
  "CLI_ARGUMENT_INVALID",
  "PROCESS_START_FAILED",
  "PROCESS_TIMEOUT",
  "WX_PROJECT_CONFIG_INVALID",
  "WX_CONTENT_UNREADABLE",
  "WX_WORKERS_INVALID",
  "WX_CI_VERSION_UNSUPPORTED",
  "CFG_CONFIG_NOT_FOUND",
  "CFG_CONFIG_INVALID_JSON",
  "CFG_CONFIG_EXISTS",
  "CFG_CONFIG_PATH_CONFLICT",
  "CFG_DEPOT_SOURCE_OUTSIDE_CONTENT_ROOT",
  "CFG_DEPOT_DUPLICATE_ID",
  "CFG_SCHEMA_INVALID",
  "PAT_ESCAPE",
  "STM_STEAMCMD_NOT_FOUND",
  "STM_NO_USERNAME",
  "STM_SETLIVE_DEFAULT",
  "STM_SETLIVE_EMPTY_BRANCH",
  "STM_CONFIG_VDF_INVALID",
  "STM_CONFIG_VDF_CONFLICT",
  "STM_TOTP_INVALID",
  "STM_BUILD_FAILED",
  "STM_BUILD_UNKNOWN_OUTCOME",
  "STM_LOGIN_GUARD_REQUIRED",
  "STM_CONTENT_ROOT_MISSING",
  "STM_EXECUTABLE_MISSING",
  "STM_APPID_FILE_MISMATCH",
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
  "WX_KEY_NOT_FOUND",
  "WX_KEY_INVALID",
  "WX_CI_NOT_INSTALLED",
  "WX_UPLOAD_FAILED",
  "WX_PREVIEW_FAILED",
  "WX_VALIDATION_FAILED",
  "WX_VERSION_REQUIRED",
];

describe("suggestion registry", () => {
  it("covers every documented error code (a new code cannot ship without a fix line)", () => {
    expect(Object.keys(SUGGESTIONS).sort()).toEqual([...ALL_CODES].sort());
  });

  it("every suggestion is a concrete single-line instruction", () => {
    for (const [code, fix] of Object.entries(SUGGESTIONS)) {
      expect(
        fix.suggestion.length,
        `${code} suggestion too short`,
      ).toBeGreaterThan(10);
      expect(fix.suggestion, `${code} suggestion should instruct`).toMatch(
        /^[a-zA-Z]/,
      );
    }
  });

  it("docs links are https URLs", () => {
    for (const [code, fix] of Object.entries(SUGGESTIONS)) {
      if (fix.docs !== undefined) {
        expect(fix.docs, `${code} docs`).toMatch(/^https:\/\//);
      }
    }
  });

  it("size-limit suggestions point at the actual levers", () => {
    expect(suggest("WX_MAIN_OVER_LIMIT").suggestion).toMatch(/subpackage|CDN/i);
    expect(suggest("WX_MAIN_OVER_LIMIT").suggestion).toMatch(
      /largest-files|minify/i,
    );
    expect(suggest("WX_TOTAL_OVER_LIMIT").suggestion).toMatch(/CDN/);
    expect(suggest("STM_SETLIVE_DEFAULT").suggestion).toMatch(/default/);
  });
});

describe("CliError suggestion integration", () => {
  it("auto-fills suggestion and docs from the registry", () => {
    const err = new CliError("STM_STEAMCMD_NOT_FOUND", "steamcmd not found");
    expect(err.suggestion).toBe(suggest("STM_STEAMCMD_NOT_FOUND").suggestion);
    expect(err.docs).toMatch(/steamcmd/i);
    expect(err.exitCode).toBe(2);
  });

  it("explicit suggestions win over the registry", () => {
    const err = new CliError("WX_UPLOAD_FAILED", "boom", {
      suggestion: "custom fix",
    });
    expect(err.suggestion).toBe("custom fix");
  });

  it("exit codes follow the documented semantics", () => {
    expect(new CliError("WX_VALIDATION_FAILED", "x").exitCode).toBe(1);
    expect(new CliError("WX_MAIN_OVER_LIMIT", "x").exitCode).toBe(1);
    expect(new CliError("STM_SETLIVE_DEFAULT", "x").exitCode).toBe(1);
    expect(new CliError("STM_STEAMCMD_NOT_FOUND", "x").exitCode).toBe(2);
    expect(new CliError("WX_KEY_NOT_FOUND", "x").exitCode).toBe(2);
    expect(new CliError("STM_BUILD_FAILED", "x").exitCode).toBe(3);
    expect(new CliError("WX_UPLOAD_FAILED", "x").exitCode).toBe(4);
  });
});
