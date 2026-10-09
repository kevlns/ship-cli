import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { loadConfig } from "../src/core/config.ts";
import { runProcess } from "../src/core/exec.ts";
import { validateWechatProject } from "../src/wx/validate.ts";
import { parseGameJson } from "../src/wx/gamejson.ts";

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let root: string;
let key: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-regression-"));
  key = path.join(root, "upload.pem");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    privateKeyEncoding: { format: "pem", type: "pkcs1" },
    publicKeyEncoding: { format: "pem", type: "pkcs1" },
  });
  await fs.writeFile(key, privateKey);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const cli = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync(
    process.execPath,
    [path.join(tool, "dist/cli.mjs"), "--project", root, ...args],
    {
      encoding: "utf8",
      env: { ...process.env, SHIP_WX_PRIVATE_KEY: key, ...env },
    },
  );
async function game(): Promise<void> {
  const dir = path.join(root, "game");
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, "game.js"), "console.log('game')");
  await fs.writeFile(path.join(dir, "game.json"), "{}");
  await fs.writeFile(
    path.join(dir, "project.config.json"),
    JSON.stringify({ appid: "wx0123456789abcdef", compileType: "game" }),
  );
  await fs.writeFile(
    path.join(root, "ship.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      wechat: {
        appid: "wx0123456789abcdef",
        projectPath: "game",
        setting: { minify: true },
        ignores: ["node_modules/**/*"],
      },
    }),
  );
}
async function sdk(): Promise<string> {
  const dir = path.join(root, "node_modules/miniprogram-ci");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "miniprogram-ci",
      version: "2.1.31",
      main: "index.js",
    }),
  );
  await fs.writeFile(
    path.join(dir, "index.js"),
    `
    const fs=require('node:fs');const path=require('node:path');let project;
    module.exports={Project:class{constructor(options){project=options;}},
      upload:async(options)=>{if(process.env.SHIP_TEST_MODE==='no-result')process.exit(0);
        fs.writeFileSync(path.join(project.projectPath,'../trace.json'),JSON.stringify({project,version:options.version,robot:options.robot,setting:options.setting}));
        return {subPackageInfo:[{name:'__FULL__',size:200},{name:'__APP__',size:200}]};},
      preview:async(options)=>{if(process.env.SHIP_TEST_MODE!=='no-qr')fs.writeFileSync(options.qrcodeOutputDest,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
        return {subPackageInfo:[{name:'__FULL__',size:200}]};}};`,
  );
  return dir;
}

describe("actual CLI and SDK completion protocol", () => {
  it("upload --version and --robot reach SDK; structured settings are effective", async () => {
    await game();
    await sdk();
    const result = cli([
      "wx",
      "push",
      "--version",
      "1.2.3",
      "--robot",
      "2",
      "--json",
    ]);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.version).toBe("1.2.3");
    const trace = JSON.parse(
      await fs.readFile(path.join(root, "trace.json"), "utf8"),
    );
    expect(trace.robot).toBe(2);
    expect(trace.version).toBe("1.2.3");
    expect(trace.setting).toEqual({ useProjectConfig: true, minify: true });
    expect(trace.project.ignores).toEqual(["node_modules/**/*"]);
  });
  it("zero exit with no completion record is a failure", async () => {
    await game();
    await sdk();
    const result = cli(["wx", "push", "--version", "1.2.3", "--json"], {
      SHIP_TEST_MODE: "no-result",
    });
    expect(result.status).toBe(4);
    expect(JSON.parse(result.stdout).error.code).toBe("WX_UPLOAD_FAILED");
  });
  it("preview reports actual QR path and rejects success without a PNG", async () => {
    await game();
    await sdk();
    let result = cli(["wx", "preview", "--robot", "3", "--json"]);
    expect(result.status, result.stdout).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(path.isAbsolute(output.qrOut)).toBe(true);
    expect((await fs.stat(output.qrOut)).size).toBeGreaterThan(8);
    result = cli(["wx", "preview", "--json"], { SHIP_TEST_MODE: "no-qr" });
    expect(result.status).toBe(4);
    expect(JSON.parse(result.stdout).error.code).toBe("WX_PREVIEW_FAILED");
  });
  it("invalid robot and missing version are structured parser errors", async () => {
    await game();
    for (const args of [
      ["wx", "preview", "--robot", "2x", "--json"],
      ["wx", "push", "--json"],
    ]) {
      const result = cli(args);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).ok).toBe(false);
    }
  });
  it("invalid project JSON prevents SDK execution", async () => {
    await game();
    await sdk();
    await fs.writeFile(path.join(root, "game/project.config.json"), "{invalid");
    const result = cli(["wx", "push", "--version", "1.0.0", "--json"]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("WX_VALIDATION_FAILED");
    expect(
      await fs.stat(path.join(root, "trace.json")).catch(() => null),
    ).toBeNull();
  });
  it("old ciArgs is rejected rather than silently ignored", async () => {
    await game();
    const file = path.join(root, "ship.config.json"),
      config = JSON.parse(await fs.readFile(file, "utf8"));
    config.wechat.ciArgs = ["--minify"];
    await fs.writeFile(file, JSON.stringify(config));
    await expect(loadConfig(root)).rejects.toMatchObject({
      code: "CFG_SCHEMA_INVALID",
    });
  });
});

describe("path and resource validation", () => {
  it("refuses Windows escaping paths on every host", async () => {
    for (const projectPath of [
      "build/..\\..\\outside",
      "C:\\outside",
      "//host/share",
    ]) {
      await fs.writeFile(
        path.join(root, "ship.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          wechat: { appid: "wx0123456789abcdef", projectPath },
        }),
      );
      await expect(loadConfig(root)).rejects.toMatchObject({
        code: "CFG_SCHEMA_INVALID",
      });
    }
  });
  it("resolves output junctions before content isolation checks", async () => {
    await fs.mkdir(path.join(root, "content"));
    const link = path.join(root, "output");
    await fs.symlink(path.join(root, "content"), link, "junction");
    try {
      await fs.writeFile(
        path.join(root, "ship.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          steam: {
            appId: 1,
            contentRoot: "content",
            buildOutput: "output",
            depots: [{ id: 2, source: "." }],
          },
        }),
      );
      await expect(loadConfig(root)).rejects.toMatchObject({
        code: "CFG_CONFIG_PATH_CONFLICT",
      });
    } finally {
      await fs.unlink(link);
    }
  });
  it("measures filtered source while respecting packOptions include precedence", async () => {
    await game();
    const dir = path.join(root, "game");
    await fs.mkdir(path.join(dir, "extras"));
    await fs.writeFile(path.join(dir, "extras/drop.bin"), Buffer.alloc(1024));
    await fs.writeFile(path.join(dir, "extras/keep.bin"), Buffer.alloc(2048));
    await fs.writeFile(
      path.join(dir, "project.config.json"),
      JSON.stringify({
        appid: "wx0123456789abcdef",
        compileType: "game",
        packOptions: {
          ignore: [{ type: "folder", value: "extras" }],
          include: [{ type: "file", value: "extras/keep.bin" }],
        },
      }),
    );
    const result = await validateWechatProject(
      { appid: "wx0123456789abcdef", projectPath: "game" },
      root,
    );
    expect(result.ok).toBe(true);
    expect(result.measurement).toBe("filtered-source-estimate");
    expect(result.main.files).toBe(4);
  });
  it("supports official virtual roots and worker package objects", () => {
    const parsed = parseGameJson(
      JSON.stringify({
        subPackages: [{ name: "a", root: "/moduleA/" }],
        workers: { path: "workers", isSubpackage: true },
      }),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.gameJson?.subpackages[0]?.root).toBe("moduleA");
    expect(parsed.gameJson?.workers).toEqual({
      path: "workers",
      isSubpackage: true,
    });
  });
});

describe("process safety", () => {
  it("resolves configured Steam tools from the config directory when called below it",async()=>{
    const nested=path.join(root,"nested");await fs.mkdir(nested);
    await fs.writeFile(path.join(root,"ship.config.json"),JSON.stringify({schemaVersion:1,steam:{appId:1,steamcmdPath:"tools/steamcmd.exe",contentRoot:"content",buildOutput:"cache",depots:[{id:2,source:"."}]}}));
    expect((await loadConfig(nested)).steam?.steamcmdPath).toBe(path.join(root,"tools/steamcmd.exe"));
  });
  it("Steam local checks support platform libraries and fail on missing executables", async () => {
    const content = path.join(root, "content");
    await fs.mkdir(content);
    await fs.writeFile(path.join(content, "steam_appid.txt"), "1\n");
    await fs.writeFile(
      path.join(content, "libsteam_api.so"),
      "library fixture",
    );
    const config = {
      schemaVersion: 1,
      steam: {
        appId: 1,
        contentRoot: "content",
        buildOutput: "cache",
        executable: "game",
        depots: [{ id: 2, source: "." }],
      },
    };
    await fs.writeFile(
      path.join(root, "ship.config.json"),
      JSON.stringify(config),
    );
    let result = cli(["steam", "test", "--json"]);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe("STM_EXECUTABLE_MISSING");
    await fs.writeFile(path.join(content, "game"), "executable fixture");
    result = cli(["steam", "test", "--json"]);
    expect(result.status, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout).steamApiLibraries).toEqual([
      path.join(content, "libsteam_api.so"),
    ]);
  });
  it("ignored dependency junctions do not enter the package scan", async () => {
    await game();
    const outside = path.join(root, "dependencies");
    await fs.mkdir(outside);
    const link = path.join(root, "game/node_modules");
    await fs.symlink(outside, link, "junction");
    try {
      const result = await validateWechatProject(
        { appid: "wx0123456789abcdef", projectPath: "game" },
        root,
      );
      expect(result.ok).toBe(true);
    } finally {
      await fs.unlink(link);
    }
  });
  it("rejects conflicting official subpackage spellings", () => {
    expect(parseGameJson('{"subpackages":[],"subPackages":[]}').ok).toBe(false);
  });
  it("redacts secrets split across chunks in capture and progress", async () => {
    const lines: string[] = [];
    const result = await runProcess(
      process.execPath,
      [
        "-e",
        "process.stdout.write('AUDIT_SECRET_');setTimeout(()=>process.stdout.write('TOKEN\\n'),100)",
      ],
      { redact: ["AUDIT_SECRET_TOKEN"], onLine: (line) => lines.push(line) },
    );
    expect(result.stdout).toBe("***\n");
    expect(lines).toEqual(["***"]);
  });
  it("timeout is an explicit failure instead of a possible successful close", async () => {
    await expect(
      runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "PROCESS_TIMEOUT" });
  });
});
