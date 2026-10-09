import path from "node:path";
import type { Command } from "commander";
import { CliError } from "../core/errors.ts";
import {
  loadConfig,
  resolveFromProject,
  type ShipConfig,
  type WechatConfig,
} from "../core/config.ts";
import { log } from "../core/logger.ts";
import { actualPath, isInsidePath, openUrl } from "../core/fsx.ts";
import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";

function parseRobot(value: string): number {
  if (!/^(?:[1-9]|[12][0-9]|30)$/.test(value))
    throw new CliError(
      "CLI_ARGUMENT_INVALID",
      "--robot must be an integer from 1 to 30",
    );
  return Number(value);
}
import {
  formatBytes,
  validateWechatProject,
  type WxValidationReport,
} from "../wx/validate.ts";
import {
  resolveMiniprogramCi,
  resolvePrivateKey,
  runWxCi,
} from "../wx/cicli.ts";

function requireWechat(config: ShipConfig): WechatConfig {
  if (config.wechat === undefined) {
    throw new CliError(
      "CFG_SCHEMA_INVALID",
      "ship.config.json has no wechat section",
    );
  }
  return config.wechat;
}

/** Complete human-readable report: sizes, per-error fix suggestions, largest-files analysis. */
export function renderWxReport(report: WxValidationReport): void {
  log.info(
    "sizes are filtered source estimates; miniprogram-ci compilation determines actual package sizes",
  );
  log.info(`project: ${report.projectPath} (appid ${report.appid})`);
  const mainExceeded = report.main.bytes > report.limits.main;
  log.info(
    `main: ${formatBytes(report.main.bytes)} / ${formatBytes(report.limits.main)} (${report.main.files} files)${mainExceeded ? "  EXCEEDED" : ""}`,
  );
  for (const sub of report.subpackages) {
    const limit =
      sub.limitBytes !== undefined ? ` / ${formatBytes(sub.limitBytes)}` : "";
    const exceeded = sub.limitBytes !== undefined && sub.bytes > sub.limitBytes;
    log.info(
      `subpackage "${sub.name}"${sub.independent ? " (independent)" : ""}: ${formatBytes(sub.bytes)}${limit} (${sub.files} files)${exceeded ? "  EXCEEDED" : ""}`,
    );
  }
  if (report.openDataContext !== null) {
    log.info(
      `openDataContext "${report.openDataContext.dir}": ${formatBytes(report.openDataContext.bytes)} (counts toward main)`,
    );
  }
  const totalExceeded = report.total.bytes > report.limits.total;
  log.info(
    `total: ${formatBytes(report.total.bytes)} / ${formatBytes(report.limits.total)}${totalExceeded ? "  EXCEEDED" : ""}`,
  );

  if (report.analysis.length > 0) {
    for (const item of report.analysis) {
      log.info(`largest files in ${item.package} (top ${item.files.length}):`);
      for (const file of item.files) {
        log.info(`  ${formatBytes(file.bytes).padStart(8)}  ${file.path}`);
      }
    }
  }

  if (report.errors.length > 0) {
    log.error(`errors (${report.errors.length}):`);
    report.errors.forEach((error, index) => {
      log.error(`  [E${index + 1}] ${error.code} — ${error.subject}`);
      log.error(`       ${error.message}`);
      log.error(`       fix: ${error.suggestion}`);
      if (error.docs !== undefined) log.error(`       docs: ${error.docs}`);
    });
  }
  if (report.warnings.length > 0) {
    log.warn(`warnings (${report.warnings.length}):`);
    for (const warning of report.warnings) log.warn(`  - ${warning}`);
  }
}

export async function runWxValidate(
  startDir: string,
  json: boolean,
): Promise<void> {
  const config = await loadConfig(startDir);
  const wechat = requireWechat(config);
  const report = await validateWechatProject(
    wechat,
    config.projectRoot,
    config.limits,
  );

  if (!json) {
    renderWxReport(report);
  }
  if (!report.ok) {
    throw new CliError(
      "WX_VALIDATION_FAILED",
      `${report.errors.length} validation error(s)${json ? "" : " — see report above"}`,
      {
        details: json ? report : undefined,
      },
    );
  }
  if (json) {
    log.result(report);
  }
}

export interface WxPushOptions {
  version: string;
  desc?: string;
  robot?: number;
  qrOut?: string;
  json: boolean;
}

export async function runWxPreview(
  startDir: string,
  opts: WxPushOptions,
): Promise<void> {
  const config = await loadConfig(startDir);
  const wechat = requireWechat(config);
  if (opts.version !== undefined && opts.version !== "") {
    throw new CliError(
      "CFG_SCHEMA_INVALID",
      "wx preview does not take --version (uploads create versions; previews do not)",
    );
  }
  const validation = await validateWechatProject(
    wechat,
    config.projectRoot,
    config.limits,
  );
  const structural = validation.errors.filter(
    (error) =>
      ![
        "WX_MAIN_OVER_LIMIT",
        "WX_INDEPENDENT_OVER_LIMIT",
        "WX_TOTAL_OVER_LIMIT",
      ].includes(error.code),
  );
  if (structural.length)
    throw new CliError(
      "WX_VALIDATION_FAILED",
      "preview blocked by invalid game structure",
      { details: validation },
    );
  await executeWxCi(config, wechat, { mode: "preview", opts });
}

export async function runWxPush(
  startDir: string,
  opts: WxPushOptions,
): Promise<void> {
  if (!opts.version?.trim())
    throw new CliError(
      "WX_VERSION_REQUIRED",
      "upload requires a non-empty --version",
    );
  const config = await loadConfig(startDir);
  const wechat = requireWechat(config);
  const validation = await validateWechatProject(
    wechat,
    config.projectRoot,
    config.limits,
  );
  if (!validation.ok) {
    if (!opts.json) {
      log.error("refusing to upload — validation failed:");
      renderWxReport(validation);
    }
    throw new CliError(
      "WX_VALIDATION_FAILED",
      "upload blocked until wx validate passes",
      {
        details: opts.json ? validation : undefined,
      },
    );
  }
  await executeWxCi(config, wechat, { mode: "upload", opts });
}

interface ExecuteInput {
  mode: "upload" | "preview";
  opts: WxPushOptions;
}

async function executeWxCi(
  config: ShipConfig,
  wechat: WechatConfig,
  input: ExecuteInput,
): Promise<void> {
  const projectPath = resolveFromProject(config, wechat.projectPath);
  const robot = input.opts.robot ?? wechat.robot ?? 1;
  if (!Number.isInteger(robot) || robot < 1 || robot > 30) {
    throw new CliError(
      "CFG_SCHEMA_INVALID",
      `robot must be an integer in 1..30 (got ${robot})`,
    );
  }
  const pkgDir = await resolveMiniprogramCi([projectPath, config.projectRoot]);
  const privateKeyPath = await resolvePrivateKey(
    process.env,
    wechat.privateKeyPath,
    config.projectRoot,
  );
  if (isInsidePath(actualPath(projectPath), actualPath(privateKeyPath)))
    throw new CliError(
      "WX_KEY_INVALID",
      "upload private key must be outside packaged game content",
    );
  const qrOut =
    input.mode === "preview"
      ? input.opts.qrOut
        ? path.resolve(config.projectRoot, input.opts.qrOut)
        : resolveFromProject(
            config,
            `build/ship-preview/${randomUUID()}/qr.png`,
          )
      : undefined;
  if (qrOut) {
    if (isInsidePath(actualPath(projectPath), actualPath(qrOut)))
      throw new CliError(
        "PAT_ESCAPE",
        "QR output must be outside packaged game content",
      );
    try {
      await fsp.lstat(qrOut);
      throw new CliError(
        "PAT_ESCAPE",
        `QR output already exists; choose another --qr-out: ${qrOut}`,
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    await fsp.mkdir(path.dirname(qrOut), { recursive: true });
  }

  if (!input.opts.json) {
    log.info(`miniprogram-ci: ${pkgDir}`);
    log.info(`project: ${projectPath}  appid ${wechat.appid}  robot ${robot}`);
    log.info(
      input.mode === "upload"
        ? `upload dev-version ${input.opts.version ?? ""} (creates a new 开发版; select it as 体验版 in the MP backend)`
        : `preview (QR code for phone testing)`,
    );
  }

  const result = await runWxCi({
    mode: input.mode,
    pkgDir,
    appid: wechat.appid,
    projectPath,
    privateKeyPath,
    version: input.opts.version,
    desc: input.opts.desc,
    robot,
    qrcodeOutputDest: qrOut,
    ignores: wechat.ignores,
    setting: wechat.setting,
    bigPackageSizeSupport: wechat.bigPackageSizeSupport,
    timeoutMs: wechat.timeoutMs,
  });

  if (result.exitCode !== 0 || result.errorMessage !== undefined) {
    throw new CliError(
      input.mode === "upload" ? "WX_UPLOAD_FAILED" : "WX_PREVIEW_FAILED",
      result.errorMessage ??
        `miniprogram-ci exited with code ${result.exitCode}`,
      { exitCode: 4, details: { output: result.output.slice(-4000) } },
    );
  }

  if (input.opts.json) {
    log.result({
      ok: true,
      mode: input.mode,
      appid: wechat.appid,
      robot,
      version: input.opts.version ?? null,
      qrOut: qrOut ?? null,
      result: result.result ?? null,
    });
    return;
  }
  log.info("done");
  if (qrOut) log.info(`QR image: ${qrOut}`);
  if (input.mode === "upload") {
    log.info(
      "next (human steps): MP 后台 -> 版本管理 -> 开发版本 -> 选为体验版 / 提交审核。审核通过后才能全量发布或灰度。",
    );
  }
}

export async function runWxOpen(
  _startDir: string,
  target: string,
): Promise<void> {
  if (target === "mp") {
    await openUrl("https://mp.weixin.qq.com/");
    return;
  }
  throw new CliError(
    "CFG_SCHEMA_INVALID",
    `unknown wx open target "${target}" (supported: mp)`,
  );
}

export function registerWxCommand(program: Command): void {
  const wx = program
    .command("wx")
    .description(
      "WeChat mini game packaging checks, preview QR and dev-version upload",
    );

  wx.command("validate")
    .description(
      "offline structural + package-size validation (main 4M / independent subpackage 4M / total 30M)",
    )
    .option("--json", "print JSON report")
    .action(async (options: { json?: boolean }) => {
      await runWxValidate(process.cwd(), options.json === true);
    });

  wx.command("preview")
    .description(
      "generate a phone-test QR code via miniprogram-ci (no version created)",
    )
    .option(
      "--qr-out <file>",
      "new PNG QR image outside packaged content (relative to project)",
    )
    .option("--desc <text>", "note shown in the dev-version list")
    .option("--robot <n>", "miniprogram-ci robot slot 1-30", parseRobot)
    .option("--json", "print JSON result")
    .action(
      async (options: {
        qrOut?: string;
        desc?: string;
        robot?: number;
        json?: boolean;
      }) => {
        await runWxPreview(process.cwd(), {
          version: "",
          desc: options.desc,
          robot: options.robot,
          qrOut: options.qrOut,
          json: options.json === true,
        });
      },
    );

  wx.command("push")
    .description(
      "upload a new dev version via miniprogram-ci (validate first; NEVER submits for review)",
    )
    .requiredOption("--version <text>", "dev-version number, e.g. 1.0.0")
    .option("--desc <text>", "upload note / changelog shown in the backend")
    .option("--robot <n>", "miniprogram-ci robot slot 1-30", parseRobot)
    .option("--json", "print JSON result")
    .action(
      async (options: {
        version: string;
        desc?: string;
        robot?: number;
        json?: boolean;
      }) => {
        await runWxPush(process.cwd(), {
          version: options.version,
          desc: options.desc,
          robot: options.robot,
          json: options.json === true,
        });
      },
    );

  wx.command("open <target>")
    .description("open the WeChat MP backend (mp)")
    .action(async (target: string) => {
      await runWxOpen(process.cwd(), target);
    });
}
