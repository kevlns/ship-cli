#!/usr/bin/env node
/**
 * Install smoke test: pack the real tarball, install it globally into an
 * isolated prefix, and drive the bin through core offline flows.
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
const tarballName = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`;

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ship-install-"));
try {
  npmExecFile(["pack", "--quiet", `--pack-destination=${tmp}`], {
    cwd: root,
    encoding: "utf8",
  });
  const tarball = path.join(tmp, tarballName);
  const prefix = path.join(tmp, "prefix");
  fs.mkdirSync(prefix, { recursive: true });
  npmExecFile(["install", "--global", "--prefix", prefix, tarball], {
    cwd: tmp,
    encoding: "utf8",
  });

  const binDir = path.join(prefix, process.platform === "win32" ? "" : "bin");
  const binPath =
    process.platform === "win32"
      ? path.join(prefix, "ship-cli.cmd")
      : path.join(binDir, "ship-cli");
  // .cmd shims must go through cmd.exe (node refuses to spawn them directly)
  const run = (args) =>
    process.platform === "win32"
      ? execFileSync("cmd", ["/c", binPath, ...args], {
          cwd: tmp,
          encoding: "utf8",
        })
      : execFileSync(binPath, args, { cwd: tmp, encoding: "utf8" });

  const version = run(["--version"]).trim();
  if (version !== pkg.version)
    throw new Error(`--version returned ${version}, expected ${pkg.version}`);
  run(["--help"]);

  const project = path.join(tmp, "project");
  fs.mkdirSync(project, { recursive: true });
  const initJson = JSON.parse(
    run(["--project", project, "config", "init", "--json"]),
  );
  if (!fs.existsSync(initJson.written))
    throw new Error("config init did not write the file");
  const validateJson = JSON.parse(
    run(["--project", project, "config", "validate", "--json"]),
  );
  if (validateJson.ok !== true)
    throw new Error("config validate failed on the fresh template");

  const doctorJson = JSON.parse(
    run(["--project", project, "doctor", "--json"]),
  );
  if (doctorJson.config?.found !== true)
    throw new Error("doctor did not find the config");

  console.log(
    `install smoke OK: ship-cli ${version} (config init/validate, doctor)`,
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
