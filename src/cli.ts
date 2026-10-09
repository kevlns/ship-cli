import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import { CliError, exitCodeFor } from "./core/errors.ts";
import { log } from "./core/logger.ts";
import { VERSION } from "./version.ts";
import { printDoctor, runDoctor } from "./commands/doctor.ts";
import {
  runConfigInit,
  runConfigShow,
  runConfigValidate,
} from "./commands/config.ts";
import { registerSteamCommand } from "./commands/steam.ts";
import { registerWxCommand } from "./commands/wx.ts";

/**
 * Extract `--project <dir>` / `--project=<dir>` before commander parsing so
 * every command resolves config from that directory (default: cwd).
 */
function extractProjectArg(argv: string[]): {
  argv: string[];
  project?: string;
} {
  const out: string[] = [];
  let project: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === "--project") {
      const value = argv[i + 1];
      if (
        value === undefined ||
        value.startsWith("--") ||
        project !== undefined
      ) {
        throw new CliError(
          "CLI_ARGUMENT_INVALID",
          "--project requires one directory argument",
        );
      }
      project = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--project=")) {
      if (!token.slice("--project=".length) || project !== undefined)
        throw new CliError(
          "CLI_ARGUMENT_INVALID",
          "--project must appear once with a non-empty directory",
        );
      project = token.slice("--project=".length);
      continue;
    }
    out.push(token);
  }
  return { argv: out, project };
}

/**
 * Family convention: a leading `--json` must still reach the subcommand's own
 * option (e.g. `ship-cli --json wx validate`). Move leading flags to the end
 * of argv so commander binds them to the executed subcommand.
 */
function normalizeLeadingJson(argv: string[]): string[] {
  const rest = [...argv];
  let sawJson = false;
  while (rest[0] === "--json") {
    sawJson = true;
    rest.shift();
  }
  return sawJson ? [...rest, "--json"] : rest;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("ship-cli")
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({
      writeErr: (message) => {
        if (!log.json) process.stderr.write(message);
      },
    })
    .option(
      "--project <dir>",
      "project directory (also accepted after subcommands)",
    )
    .version(VERSION)
    .description(
      "Cross-platform game shipping CLI: package, validate and push builds (Steam, WeChat mini games). Never publishes to players on its own.",
    );

  program
    .command("doctor")
    .description(
      "environment + config + credential preflight (offline, no network calls)",
    )
    .option("--json", "print JSON report")
    .action(async (options: { json?: boolean }) => {
      const report = await runDoctor(process.cwd());
      printDoctor(report, options.json === true);
    });

  const config = program
    .command("config")
    .description("ship.config.json management");
  config
    .command("init")
    .description(
      "write a ship.config.json template (refuses to overwrite without --force)",
    )
    .option("--force", "overwrite an existing file", false)
    .option("--json", "print JSON result")
    .action(async (options: { force: boolean; json?: boolean }) => {
      await runConfigInit(process.cwd(), options.force, options.json === true);
    });
  config
    .command("validate")
    .description("load + schema + cross-field validation")
    .option("--json", "print JSON result")
    .action(async (options: { json?: boolean }) => {
      await runConfigValidate(process.cwd(), options.json === true);
    });
  config
    .command("show")
    .description("print the normalized config")
    .option("--json", "print JSON result")
    .action(async (options: { json?: boolean }) => {
      await runConfigShow(process.cwd(), options.json === true);
    });

  registerSteamCommand(program);
  registerWxCommand(program);
  return program;
}

export async function main(argv: string[]): Promise<number> {
  log.json = argv.includes("--json");
  const originalCwd = process.cwd();
  try {
    const { argv: withoutProject, project } = extractProjectArg(argv);
    if (project !== undefined) {
      const resolved = path.resolve(project);
      const fs = await import("node:fs/promises");
      const stat = await fs.stat(resolved).catch(() => undefined);
      if (stat === undefined || !stat.isDirectory()) {
        throw new CliError(
          "CFG_CONFIG_NOT_FOUND",
          `--project is not a directory: ${resolved}`,
        );
      }
      process.chdir(resolved);
    }
    const program = buildProgram();
    await program.parseAsync(normalizeLeadingJson(withoutProject), {
      from: "user",
    });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError && err.exitCode === 0) return 0;
    throw err;
  } finally {
    process.chdir(originalCwd);
  }
}

export function cliErrorExit(err: unknown): number {
  if (log.json) {
    const error =
      err instanceof CliError
        ? err
        : new CliError(
            "CLI_ARGUMENT_INVALID",
            err instanceof Error ? err.message : String(err),
          );
    log.result({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        fix: error.suggestion,
        docs: error.docs,
      },
    });
    return error.exitCode;
  }
  if (err instanceof CliError) {
    log.error(`${err.code}: ${err.message}`);
    if (err.suggestion !== undefined) log.error(`fix: ${err.suggestion}`);
    if (err.docs !== undefined) log.error(`docs: ${err.docs}`);
    if (err.details !== undefined) {
      log.error(JSON.stringify(err.details, null, 2));
    }
    return err.exitCode || exitCodeFor(err.code);
  }
  log.error(err instanceof Error ? `${err.stack ?? err.message}` : String(err));
  return 1;
}

const invokedDirect =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirect) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    process.exitCode = cliErrorExit(err);
  }
}
