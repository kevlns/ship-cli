#!/usr/bin/env node
/**
 * Publish content guard (family convention). Fails closed when:
 *  - tarball identity (name/version) does not match package.json
 *  - required runtime files are missing (dist, schemas, manifest, docs)
 *  - forbidden content is shipped (src/tests/scripts/node_modules/docs)
 *  - runtime deps are not exactly pinned
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

/** Cross-platform npm resolution: npm_execpath (npm run env) > npm-cli.js > bare command. */
function npmExec() {
  if (process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) {
    return { cmd: process.execPath, args: [process.env.npm_execpath] };
  }
  const fallback = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  if (fs.existsSync(fallback)) {
    return { cmd: process.execPath, args: [fallback] };
  }
  return { cmd: process.platform === "win32" ? "npm.cmd" : "npm", args: [] };
}

function npmExecFile(args, options) {
  const npm = npmExec();
  return execFileSync(npm.cmd, [...npm.args, ...args], options);
}

const REQUIRED = [
  "dist/cli.mjs",
  "dist/index.mjs",
  "schemas/ship-config.schema.json",
  "v-cli.plugin.json",
  "AGENTS.md",
  "README.md",
  "docs/research/steam.md",
  "docs/research/wechat-minigame.md",
  "LICENSE",
];
const FORBIDDEN_PREFIXES = [
  "src/",
  "tests/",
  "scripts/",
  "node_modules/",
  ".github/",
];

const problems = [];

// dry-run manifest
const dry = npmExecFile(["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: root,
  encoding: "utf8",
});
const files = JSON.parse(dry)[0].files.map((f) => f.path);
for (const required of REQUIRED) {
  if (!files.includes(required))
    problems.push(`missing required file in tarball: ${required}`);
}
for (const file of files) {
  if (FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix))) {
    problems.push(`forbidden content in tarball: ${file}`);
  }
}

// identity
const tarballName = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`;
if (!JSON.parse(dry)[0].filename.endsWith(tarballName)) {
  problems.push(`tarball filename mismatch: expected *${tarballName}`);
}

// manifest identity
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "v-cli.plugin.json"), "utf8"),
);
if (manifest.package !== pkg.name)
  problems.push(`manifest.package (${manifest.package}) != package name`);
if (manifest.bin !== Object.keys(pkg.bin)[0])
  problems.push("manifest.bin != package.json bin name");
const versionSource = fs.readFileSync(
  path.join(root, "src/version.ts"),
  "utf8",
);
if (!versionSource.includes(`VERSION = "${pkg.version}"`)) {
  problems.push("src/version.ts VERSION does not match package.json version");
}

// deps exactly pinned
for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
  if (!/^\d+\.\d+\.\d+$/.test(range))
    problems.push(`dependency ${dep} must be exactly pinned (got ${range})`);
}

// engines
if (pkg.engines?.node !== ">=20")
  problems.push(`engines.node must be ">=20" (got ${pkg.engines?.node})`);

// real pack + tar listing cross-check
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ship-pack-guard-"));
try {
  npmExecFile(["pack", "--quiet", `--pack-destination=${tmp}`], {
    cwd: root,
    encoding: "utf8",
  });
  const listing = execFileSync("tar", ["-tzf", tarballName], {
    cwd: tmp,
    encoding: "utf8",
  });
  const entries = listing
    .split(/\r?\n/)
    .map((line) => line.replace(/^package\//, ""))
    .filter((line) => line.length > 0 && !line.endsWith("/"));
  for (const required of REQUIRED) {
    if (!entries.includes(required))
      problems.push(`tarball listing missing: ${required}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error("pack-guard FAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`pack-guard OK: ${files.length} files, ${tarballName}`);
