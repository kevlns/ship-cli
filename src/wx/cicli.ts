import { createRequire } from "node:module";
import path from "node:path";
import fsp from "node:fs/promises";
import { createPrivateKey } from "node:crypto";
import { CliError } from "../core/errors.ts";
import { expandHome, isFile } from "../core/fsx.ts";
import { runProcess, type ProcessRunner } from "../core/exec.ts";
import { log } from "../core/logger.ts";
import { redactSecrets } from "../core/redact.ts";
import type { WechatConfig } from "../core/config.ts";

/**
 * miniprogram-ci invocation. We deliberately spawn a small `node -e` driver
 * against the documented Node API (new ci.Project / ci.upload / ci.preview)
 * instead of guessing CLI flag names; the API surface is stable and returns
 * structured data (subPackageInfo) we surface in --json output.
 *
 * miniprogram-ci is NOT a dependency of this package: resolve it from the game
 * project's node_modules (or this package's) and fail closed with install
 * instructions when absent.
 */

export interface WxCiUploadInput {
  mode: "upload" | "preview";
  pkgDir: string;
  appid: string;
  projectPath: string;
  privateKeyPath: string;
  version?: string;
  desc?: string;
  robot?: number;
  qrcodeOutputDest?: string;
  ignores?: string[];
  setting?: WechatConfig["setting"];
  bigPackageSizeSupport?: boolean;
  timeoutMs?: number;
  run?: ProcessRunner;
}

export interface WxCiResult {
  exitCode: number;
  result?: unknown;
  errorMessage?: string;
  output: string;
}

/** Resolve the miniprogram-ci package directory from candidate roots. */
export async function resolveMiniprogramCi(
  candidateRoots: string[],
): Promise<string> {
  for (const root of candidateRoots) {
    const req = createRequire(path.join(path.resolve(root), "noop.js"));
    let pkgJsonPath: string;
    try {
      pkgJsonPath = req.resolve("miniprogram-ci/package.json");
    } catch {
      continue;
    }
    try {
      const pkg = JSON.parse(await fsp.readFile(pkgJsonPath, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "miniprogram-ci") {
        const version = pkg.version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
        if (
          !version ||
          Number(version[1]) !== 2 ||
          Number(version[2]) < 1 ||
          (Number(version[2]) === 1 && Number(version[3]) < 31)
        )
          throw new CliError(
            "WX_CI_VERSION_UNSUPPORTED",
            `supported miniprogram-ci range is >=2.1.31 <3; found ${pkg.version}`,
          );
        return path.dirname(pkgJsonPath);
      }
    } catch (err) {
      if (err instanceof CliError) throw err;
      continue;
    }
  }
  throw new CliError(
    "WX_CI_NOT_INSTALLED",
    "miniprogram-ci is not resolvable; install it in the game project (npm i -D miniprogram-ci) or any parent directory",
  );
}

/** Resolve the upload private key: SHIP_WX_PRIVATE_KEY > config privateKeyPath. */
export async function resolvePrivateKey(
  env: NodeJS.ProcessEnv,
  configPath: string | undefined,
  projectRoot: string,
): Promise<string> {
  const fromEnv = env.SHIP_WX_PRIVATE_KEY;
  const raw = fromEnv ?? configPath;
  if (raw === undefined || raw === "") {
    throw new CliError(
      "WX_KEY_NOT_FOUND",
      "WeChat upload key not configured: set SHIP_WX_PRIVATE_KEY or wechat.privateKeyPath in ship.config.json. " +
        "Download the key from MP backend: 管理 -> 开发管理 -> 开发设置 -> 小程序代码上传",
    );
  }
  const expanded = expandHome(raw);
  const resolved = path.resolve(projectRoot, expanded);
  if (!(await isFile(resolved))) {
    throw new CliError(
      "WX_KEY_NOT_FOUND",
      `WeChat upload key file not found: ${resolved}`,
    );
  }
  try {
    createPrivateKey(await fsp.readFile(resolved));
  } catch {
    throw new CliError(
      "WX_KEY_INVALID",
      `WeChat upload key does not look like a PEM private key: ${resolved}`,
    );
  }
  return resolved;
}

function js(value: unknown): string {
  return JSON.stringify(value) as string;
}

/** Build the `node -e` driver script (CJS; miniprogram-ci is CJS). */
export function buildDriverScript(input: WxCiUploadInput): string {
  const lines = [
    `"use strict";`,
    `const ci = require(${js(input.pkgDir)});`,
    `function done(label, payload) { process.stdout.write(label + JSON.stringify(payload) + "\\n"); }`,
    `(async () => {`,
    `  const project = new ci.Project({`,
    `    appid: ${js(input.appid)},`,
    `    type: "miniGame",`,
    `    projectPath: ${js(input.projectPath)},`,
    `    privateKeyPath: ${js(input.privateKeyPath)},`,
    `    ignores: ${js(input.ignores ?? ["node_modules/**/*"])}`,
    `  });`,
    `  const onProgressUpdate = (task) => { try { process.stderr.write("[ci] " + (typeof task === "string" ? task : JSON.stringify(task)) + "\\n"); } catch {} };`,
  ];
  if (input.mode === "upload") {
    if (input.version === undefined || input.version === "") {
      throw new CliError(
        "WX_VERSION_REQUIRED",
        "upload requires --version (becomes the dev-version number, e.g. 1.0.0)",
      );
    }
    lines.push(
      `  const result = await ci.upload({ project, version: ${js(input.version)}, desc: ${js(input.desc ?? "")}, robot: ${input.robot ?? 1}, setting: ${js({ useProjectConfig: true, ...input.setting })}, onProgressUpdate });`,
      `  done("SHIP_RESULT_JSON:", { completed: true, mode: "upload", appid: ${js(input.appid)}, result });`,
    );
  } else {
    const dest = input.qrcodeOutputDest ?? "wx-preview-qr.png";
    lines.push(
      `  const result = await ci.preview({ project, desc: ${js(input.desc ?? "")}, robot: ${input.robot ?? 1}, setting: ${js({ useProjectConfig: true, ...input.setting })}, bigPackageSizeSupport: ${js(input.bigPackageSizeSupport ?? false)}, qrcodeFormat: "image", qrcodeOutputDest: ${js(path.resolve(dest))}, onProgressUpdate });`,
      `  done("SHIP_RESULT_JSON:", { completed: true, mode: "preview", appid: ${js(input.appid)}, result });`,
    );
  }
  lines.push(
    `})().catch((err) => { done("SHIP_ERROR_JSON:", { message: String((err && err.message) || err) }); process.exit(1); });`,
  );
  return lines.join("\n");
}

const RESULT_MARK = "SHIP_RESULT_JSON:";
const ERROR_MARK = "SHIP_ERROR_JSON:";

export async function runWxCi(input: WxCiUploadInput): Promise<WxCiResult> {
  const script = buildDriverScript(input);
  const run = input.run ?? runProcess;
  const privateKey = await fsp.readFile(input.privateKeyPath, "utf8");
  const secrets = [
    privateKey,
    ...privateKey
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("-----")),
  ];
  let result;
  try {
    result = await run(process.execPath, ["-e", script], {
      cwd: input.projectPath,
      timeoutMs: input.timeoutMs ?? 15 * 60 * 1000,
      redact: secrets,
      onLine: (line) => {
        if (
          !log.json &&
          !line.startsWith(RESULT_MARK) &&
          !line.startsWith(ERROR_MARK)
        )
          log.info(line);
      },
    });
  } catch (err) {
    const error = err as CliError;
    throw new CliError(
      input.mode === "upload" ? "WX_UPLOAD_FAILED" : "WX_PREVIEW_FAILED",
      redactSecrets(error.message, secrets),
      { details: error.details },
    );
  }
  const stdout = redactSecrets(result.stdout, secrets);
  const markers = stdout
    .split(/\r?\n/)
    .filter(
      (line) => line.startsWith(RESULT_MARK) || line.startsWith(ERROR_MARK),
    );
  const markerLine = markers.length === 1 ? markers[0] : undefined;
  let parsed: unknown;
  let errorMessage: string | undefined;
  if (markerLine !== undefined) {
    try {
      parsed = JSON.parse(
        markerLine.slice(markerLine.indexOf(":") + 1),
      ) as unknown;
      if (markerLine.startsWith(ERROR_MARK)) {
        errorMessage =
          parsed !== null && typeof parsed === "object"
            ? String(
                (parsed as { message?: unknown }).message ??
                  "miniprogram-ci failed",
              )
            : "miniprogram-ci returned an invalid error record";
      }
      if (markerLine.startsWith(RESULT_MARK)) {
        const payload = parsed as {
          completed?: unknown;
          mode?: unknown;
          appid?: unknown;
          result?: unknown;
        };
        if (
          !payload ||
          payload.completed !== true ||
          payload.mode !== input.mode ||
          payload.appid !== input.appid ||
          !payload.result ||
          typeof payload.result !== "object" ||
          Array.isArray(payload.result)
        )
          errorMessage = "miniprogram-ci completion protocol is invalid";
        else parsed = payload.result;
      }
    } catch {
      errorMessage =
        "miniprogram-ci returned an invalid JSON completion record";
    }
  } else errorMessage = "miniprogram-ci returned no unique completion record";
  if (input.mode === "preview" && result.code === 0 && !errorMessage) {
    const file = path.resolve(input.qrcodeOutputDest ?? "wx-preview-qr.png");
    const bytes = await fsp.readFile(file).catch(() => undefined);
    if (
      !bytes ||
      bytes.length < 8 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      errorMessage = "preview completed without a valid PNG QR image";
  }
  return {
    exitCode: result.code,
    result: parsed,
    errorMessage,
    output: stdout + redactSecrets(result.stderr, secrets),
  };
}
