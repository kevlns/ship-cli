import { execFile, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { CliError } from "./errors.ts";
import { redactSecrets } from "./redact.ts";

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Called with each output line (arrival order across both channels) for live echo. */
  onLine?: (line: string, channel: "stdout" | "stderr") => void;
  /** Secrets to redact from captured output and echo (never write credentials to logs). */
  redact?: string[];
  timeoutMs?: number;
}

export type ProcessRunner = (
  cmd: string,
  args: string[],
  options?: RunOptions,
) => Promise<ProcessResult>;

class RedactedStream {
  private pending = "";
  private decoder = new StringDecoder("utf8");
  constructor(private secrets: string[]) {}
  push(chunk?: Buffer): string {
    this.pending += chunk ? this.decoder.write(chunk) : this.decoder.end();
    let cut = chunk
      ? Math.max(
          0,
          this.pending.length -
            Math.max(0, ...this.secrets.map((s) => s.length - 1)),
        )
      : this.pending.length;
    for (const secret of this.secrets) {
      for (
        let at = this.pending.indexOf(secret);
        at >= 0;
        at = this.pending.indexOf(secret, at + 1)
      ) {
        if (at < cut && at + secret.length > cut) cut = at;
      }
    }
    const safe = redactSecrets(this.pending.slice(0, cut), this.secrets);
    this.pending = this.pending.slice(cut);
    return safe;
  }
}

/**
 * Spawn a process and capture output. Output is echoed line-by-line to stderr
 * (diagnostics channel; stdout stays reserved for CLI results) after secret
 * redaction. Never throws on non-zero exit; returns the code instead.
 */
export const runProcess: ProcessRunner = async function runProcess(
  cmd,
  args,
  options = {},
) {
  const redact = options.redact ?? [];
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;
    const streams = {
      stdout: new RedactedStream(redact.filter(Boolean)),
      stderr: new RedactedStream(redact.filter(Boolean)),
    };
    const lines = { stdout: "", stderr: "" };

    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            if (process.platform === "win32" && child.pid)
              execFile(
                "taskkill",
                ["/PID", String(child.pid), "/T", "/F"],
                { windowsHide: true },
                () => {},
              );
            else child.kill("SIGKILL");
          }, options.timeoutMs)
        : undefined;

    const pump = (chunk: Buffer | undefined, channel: "stdout" | "stderr") => {
      const safe = streams[channel].push(chunk);
      if (channel === "stdout") stdout += safe;
      else stderr += safe;
      if (options.onLine) {
        lines[channel] += safe;
        const complete = lines[channel].split(/\r?\n/);
        lines[channel] = complete.pop()!;
        for (const line of complete) if (line) options.onLine(line, channel);
        if (!chunk && lines[channel]) {
          options.onLine(lines[channel], channel);
          lines[channel] = "";
        }
      }
    };

    child.stdout.on("data", (chunk: Buffer) => pump(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => pump(chunk, "stderr"));
    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      reject(
        new CliError(
          "PROCESS_START_FAILED",
          `cannot start ${cmd}: ${redactSecrets(err.message, redact)}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      pump(undefined, "stdout");
      pump(undefined, "stderr");
      if (timedOut) {
        reject(
          new CliError(
            "PROCESS_TIMEOUT",
            `process exceeded ${options.timeoutMs}ms`,
            { details: { stdout, stderr } },
          ),
        );
        return;
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end();
  });
};

/** Resolve a command on PATH (`where` on Windows, `which` elsewhere). */
export function lookupOnPath(executable: string): Promise<string | undefined> {
  const isWin = process.platform === "win32";
  const name =
    isWin && !/\.(exe|cmd|bat)$/i.test(executable)
      ? `${executable}.exe`
      : executable;
  return new Promise((resolve) => {
    execFile(
      isWin ? "where" : "which",
      [name],
      { windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(undefined);
          return;
        }
        const first = stdout
          .toString()
          .split(/\r?\n/)
          .find((line) => line.trim().length > 0);
        resolve(first?.trim() || undefined);
      },
    );
  });
}
