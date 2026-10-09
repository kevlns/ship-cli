/**
 * Dual-channel output, family convention: results go to stdout (pipeable,
 * scriptable), diagnostics go to stderr. `--json` commands print exactly one
 * JSON object on stdout and nothing else.
 */
export interface Logger {
  json: boolean;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  result(payload: unknown): void;
}

export function createLogger(): Logger {
  return {
    json: false,
    info(message) {
      process.stderr.write(`${message}\n`);
    },
    warn(message) {
      process.stderr.write(`warning: ${message}\n`);
    },
    error(message) {
      process.stderr.write(`error: ${message}\n`);
    },
    result(payload) {
      if (
        this.json &&
        payload !== null &&
        typeof payload === "object" &&
        !Array.isArray(payload)
      ) {
        payload = { ok: true, ...payload };
      }
      if (typeof payload === "string") {
        process.stdout.write(`${payload}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      }
    },
  };
}

export const log = createLogger();
