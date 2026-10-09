import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Command } from "commander";
import { buildProgram } from "../src/cli.ts";
import { VERSION, PACKAGE_NAME } from "../src/version.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface ManifestOption {
  flags: string;
  description: string;
}
interface ManifestCommand {
  path: string[];
  usage: string;
  description: string;
  arguments: Array<{ name: string; required: boolean; description: string }>;
  options: ManifestOption[];
  output: { format: string; description: string };
  exitCodes: Record<string, string>;
  safety: string[];
}

async function readManifest(): Promise<Record<string, unknown>> {
  return JSON.parse(await fsp.readFile(path.join(repoRoot, "v-cli.plugin.json"), "utf8")) as Record<string, unknown>;
}

/** Key rules mirrored from v-cli's src/core/manifest.ts (contract version 1). */
describe("v-cli.plugin.json contract", () => {
  it("passes the v-cli manifest rules", async () => {
    const m = await readManifest();
    const errors: string[] = [];
    const isPlainObject = (v: unknown): v is Record<string, unknown> =>
      typeof v === "object" && v !== null && !Array.isArray(v);

    if (m.schemaVersion !== 1) errors.push("schemaVersion must be 1");
    if (!/^@[a-zA-Z0-9][a-zA-Z0-9._~-]*\/[a-zA-Z0-9][a-zA-Z0-9._~-]*$/.test(String(m.package))) {
      errors.push("package must be @scope/name");
    }
    if (!/^[a-z][a-z0-9-]*$/.test(String(m.command))) errors.push("command must match ^[a-z][a-z0-9-]*$");
    if (["doctor", "plugin", "ts", "agent", "help"].includes(String(m.command))) {
      errors.push("command is reserved by v-cli");
    }
    if (typeof m.bin !== "string" || m.bin === "") errors.push("bin must be a non-empty string");
    if (typeof m.description !== "string" || m.description === "") errors.push("description must be non-empty");
    const platforms = m.platforms;
    if (!Array.isArray(platforms) || platforms.length === 0) errors.push("platforms must be a non-empty array");
    else {
      for (const p of platforms) {
        if (!["darwin", "linux", "win32"].includes(String(p))) errors.push(`unknown platform ${String(p)}`);
      }
    }
    if (!isPlainObject(m.runtime)) errors.push("runtime must be an object");
    if (Array.isArray(m.environment)) {
      m.environment.forEach((entry, i) => {
        if (!isPlainObject(entry) || typeof entry.name !== "string" || typeof entry.description !== "string") {
          errors.push(`environment[${i}] malformed`);
        }
      });
    } else {
      errors.push("environment must be an array");
    }
    const agent = m.agent;
    if (!isPlainObject(agent)) errors.push("agent must be an object");
    else {
      if (typeof agent.whenToUse !== "string") errors.push("agent.whenToUse must be a string");
      if (!Array.isArray(agent.globalOptions)) errors.push("agent.globalOptions must be an array");
      if (!Array.isArray(agent.commands)) errors.push("agent.commands must be an array");
      else {
        const seen = new Set<string>();
        (agent.commands as ManifestCommand[]).forEach((c, i) => {
          const at = `agent.commands[${i}]`;
          if (!Array.isArray(c.path) || c.path.length === 0) errors.push(`${at}.path must be a non-empty array`);
          else {
            for (const seg of c.path) {
              if (!/^[a-z][a-z0-9-]*$/.test(seg)) errors.push(`${at}.path segment "${seg}" invalid`);
            }
            const key = c.path.join(" ");
            if (seen.has(key)) errors.push(`${at}.path ${key} duplicated`);
            seen.add(key);
          }
          if (typeof c.usage !== "string" || c.usage === "") errors.push(`${at}.usage must be non-empty`);
          if (typeof c.description !== "string" || c.description === "") errors.push(`${at}.description must be non-empty`);
          if (!Array.isArray(c.arguments)) errors.push(`${at}.arguments must be an array`);
          if (!Array.isArray(c.options)) errors.push(`${at}.options must be an array`);
          if (!isPlainObject(c.output) || !["json", "stdout", "text"].includes(String(c.output?.format))) {
            errors.push(`${at}.output.format must be json|stdout|text`);
          }
          if (!isPlainObject(c.exitCodes)) errors.push(`${at}.exitCodes must be an object`);
          if (!Array.isArray(c.safety) || c.safety.some((s) => typeof s !== "string")) {
            errors.push(`${at}.safety must be a string array`);
          }
        });
      }
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

function longFlags(flags: string): string {
  return flags
    .split(/[\s,]+/)
    .filter((part) => part.startsWith("--"))
    .join(" ");
}

function collectCommandPaths(
  command: Command,
  prefix: string[]
): Array<{ path: string; options: string[]; isLeaf: boolean }> {
  const here = [...prefix, command.name()];
  const options = command.options
    .map((option) => longFlags(option.flags))
    .filter((flag) => flag !== "--help");
  // Group commands (config/steam/wx) are navigation only; the manifest
  // documents executable leaves.
  const isLeaf = command.commands.length === 0;
  const out = [{ path: here.join(" "), options, isLeaf }];
  for (const child of command.commands) {
    out.push(...collectCommandPaths(child, here));
  }
  return out;
}

describe("manifest drift", () => {
  it("agent.commands mirror the commander tree (paths and option flags)", async () => {
    const manifest = await readManifest();
    const manifestCommands = (manifest.agent as { commands: ManifestCommand[] }).commands;
    const program = buildProgram();
    const cliPaths = new Map<string, Set<string>>();
    for (const command of program.commands) {
      for (const entry of collectCommandPaths(command, [])) {
        if (entry.isLeaf) cliPaths.set(entry.path, new Set(entry.options));
      }
    }
    const manifestPaths = new Set(manifestCommands.map((c) => c.path.join(" ")));

    const missing = [...manifestPaths].filter((p) => !cliPaths.has(p));
    const extra = [...cliPaths.keys()].filter((p) => !manifestPaths.has(p));
    expect(missing, `in manifest but not in CLI: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `in CLI but not in manifest: ${extra.join(", ")}`).toEqual([]);

    for (const entry of manifestCommands) {
      const cliOptions = cliPaths.get(entry.path.join(" "))!;
      const declared = new Set(entry.options.map((option) => longFlags(option.flags)));
      const missingOptions = [...declared].filter((flag) => !cliOptions.has(flag));
      const undocumented = [...cliOptions].filter((flag) => !declared.has(flag));
      expect(missingOptions, `${entry.path.join(" ")}: manifest documents options the CLI lacks: ${missingOptions.join(", ")}`).toEqual([]);
      expect(undocumented, `${entry.path.join(" ")}: CLI options missing from the manifest: ${undocumented.join(", ")}`).toEqual([]);
    }
  });
});

describe("package identity", () => {
  it("package.json, version.ts and the manifest agree", async () => {
    const manifest = await readManifest();
    const pkg = JSON.parse(await fsp.readFile(path.join(repoRoot, "package.json"), "utf8")) as {
      name: string;
      version: string;
      bin: Record<string, string>;
      files: string[];
      dependencies: Record<string, string>;
      engines: { node: string };
    };
    expect(pkg.name).toBe(PACKAGE_NAME);
    expect(pkg.name).toBe(manifest.package);
    expect(pkg.version).toBe(VERSION);
    expect(Object.keys(pkg.bin)).toEqual([manifest.bin]);
    expect(pkg.bin[manifest.bin as string]).toBe("dist/cli.mjs");
    for (const required of ["dist/", "schemas/", "v-cli.plugin.json", "AGENTS.md"]) {
      expect(pkg.files, `files whitelist must include ${required}`).toContain(required);
    }
    for (const depVersion of Object.values(pkg.dependencies)) {
      expect(depVersion, "runtime deps must be exactly pinned (family rule)").toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(pkg.engines.node).toBe(">=20");
  });
});
