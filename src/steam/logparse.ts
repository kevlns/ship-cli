/**
 * steamcmd outcome analysis. steamcmd exit codes are NOT reliable (many
 * failures exit 0 — see docs/research/steam.md), so the verdict comes from
 * output patterns:
 *  - failed: non-zero exit, or any documented error signature;
 *  - success: no error signature AND a build id / explicit success marker;
 *  - unknown: neither -> treated as failure (fail-closed).
 */

export interface SteamcmdOutcome {
  status: "success" | "failed" | "unknown";
  buildId?: string;
  errors: string[];
  hints: string[];
}

const ERROR_PATTERNS: Array<{ re: RegExp; hint: string }> = [
  {
    re: /\bERROR[!:]|\bFailed\b/i,
    hint: "steamcmd reported a failure; inspect the build log",
  },
  {
    re: /Login Failure|Account Login Denied|Invalid Password/i,
    hint: "login rejected: check STEAM credentials; first-time logins need a Steam Guard code (SHIP_STEAM_TOTP / SHIP_STEAM_CONFIG_VDF)",
  },
  {
    re: /Invalid content configuration/i,
    hint: "app/depot configuration not saved on the partner backend, or build account lacks Edit App Metadata",
  },
  {
    re: /Failed to get application info for app \d+/i,
    hint: "app config not yet live on the backend or wrong build account; also check the AppID",
  },
  {
    re: /Timed out waiting for AppInfo update/i,
    hint: "steamcmd timed out waiting for app info; usually transient, retry",
  },
  {
    re: /set_steam_guard_code/i,
    hint: "steamcmd is asking for a Steam Guard code; provide SHIP_STEAM_TOTP or seed config.vdf via SHIP_STEAM_CONFIG_VDF",
  },
];

const FINISHED_RE =
  /Successfully finished\s+(?:AppID\s+)?(?:build\s+)?(\d+)\s+build(?:\s*\(BuildID\s+(\d+)\))?/i;

export function analyzeSteamcmdOutput(
  stdout: string,
  stderr: string,
  exitCode: number,
  expected?: { appId: number; preview: boolean },
): SteamcmdOutcome {
  const combined = `${stdout}\n${stderr}`;
  const errors: string[] = [];
  const hints: string[] = [];

  for (const line of combined.split(/\r?\n/)) {
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.re.test(line)) {
        if (!errors.includes(line.trim())) errors.push(line.trim());
        if (!hints.includes(pattern.hint)) hints.push(pattern.hint);
      }
    }
  }

  if (errors.length > 0) {
    return { status: "failed", errors, hints };
  }
  if (exitCode !== 0) {
    return {
      status: "failed",
      errors: [`steamcmd exited with code ${exitCode}`],
      hints,
    };
  }

  const finished = FINISHED_RE.exec(combined);
  if (
    finished &&
    (!expected || Number(finished[1]) === expected.appId) &&
    (expected?.preview || finished[2])
  ) {
    return { status: "success", buildId: finished[2], errors, hints };
  }
  return {
    status: "unknown",
    errors: ["steamcmd exited 0 without a matching completed app-build record"],
    hints: [
      "inspect the full log; run with Preview first to validate the pipeline",
    ],
  };
}
