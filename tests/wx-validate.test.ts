import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  validateWechatProject,
  formatBytes,
  type WxValidationReport,
} from "../src/wx/validate.ts";
import { parseGameJson } from "../src/wx/gamejson.ts";

let tmp: string;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ship-wx-"));
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

const MIB = 1024 * 1024;

interface FixtureOptions {
  mainBytes?: number;
  subpackages?: Array<{
    name: string;
    root: string;
    independent?: boolean;
    bytes?: number;
    omitRoot?: boolean;
    omitEntryJs?: boolean;
  }>;
  openDataContext?: string;
  omit?: Array<"game.js" | "project.config.json" | "game.json">;
  extraGameJson?: Record<string, unknown>;
}

async function buildProject(opts: FixtureOptions = {}): Promise<void> {
  const project = path.join(tmp, "minigame");
  await fsp.rm(project, { recursive: true, force: true });
  await fsp.mkdir(project, { recursive: true });
  const subpackages = (opts.subpackages ?? []).map((s) => ({
    name: s.name,
    root: s.root,
    ...(s.independent === true ? { independent: true } : {}),
  }));
  if (!opts.omit?.includes("game.json")) {
    const gameJson: Record<string, unknown> = {
      deviceOrientation: "landscape",
      ...(opts.subpackages === undefined || opts.subpackages.length === 0
        ? {}
        : { subpackages }),
      ...(opts.openDataContext === undefined
        ? {}
        : { openDataContext: opts.openDataContext }),
      ...opts.extraGameJson,
    };
    await fsp.writeFile(
      path.join(project, "game.json"),
      JSON.stringify(gameJson),
    );
  }
  if (!opts.omit?.includes("game.js")) {
    await fsp.writeFile(path.join(project, "game.js"), "require('adapter.js')");
  }
  if (!opts.omit?.includes("project.config.json")) {
    await fsp.writeFile(
      path.join(project, "project.config.json"),
      JSON.stringify({
        appid: "wx0123456789abcdef",
        compileType: "game",
        libVersion: "latest",
      }),
    );
  }
  if (opts.mainBytes !== undefined) {
    await fsp.writeFile(
      path.join(project, "main.bundle.js"),
      Buffer.alloc(opts.mainBytes, 1),
    );
  }
  for (const sub of opts.subpackages ?? []) {
    if (sub.omitRoot === true) continue;
    if (/\.js$/.test(sub.root)) {
      await fsp.mkdir(path.dirname(path.join(project, sub.root)), {
        recursive: true,
      });
      await fsp.writeFile(
        path.join(project, sub.root),
        Buffer.alloc(sub.bytes ?? 10, 1),
      );
    } else {
      const dir = path.join(project, sub.root);
      await fsp.mkdir(dir, { recursive: true });
      if (sub.omitEntryJs !== true)
        await fsp.writeFile(path.join(dir, "game.js"), "module.exports=1");
      if (sub.bytes !== undefined)
        await fsp.writeFile(
          path.join(dir, "payload.bin"),
          Buffer.alloc(sub.bytes, 1),
        );
    }
  }
  if (opts.openDataContext !== undefined) {
    await fsp.mkdir(path.join(project, opts.openDataContext), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(project, opts.openDataContext, "index.js"),
      "console.log(1)",
    );
  }
}

function wechat(opts: { projectPath?: string } = {}) {
  return {
    appid: "wx0123456789abcdef",
    projectPath: opts.projectPath ?? "minigame",
    robot: 1,
  };
}

function codes(report: WxValidationReport): string[] {
  return report.errors.map((e) => e.code);
}

describe("parseGameJson", () => {
  it("accepts both subpackages and subPackages spellings", () => {
    const a = parseGameJson('{"subpackages":[{"name":"s","root":"s/"}]}');
    const b = parseGameJson('{"subPackages":[{"name":"s","root":"s/"}]}');
    expect(a.ok && a.gameJson?.subpackages).toHaveLength(1);
    expect(b.ok && b.gameJson?.subpackages).toHaveLength(1);
  });

  it("rejects unsafe roots and duplicates", () => {
    expect(
      parseGameJson('{"subpackages":[{"name":"a","root":"../x"}]}').ok,
    ).toBe(false);
    expect(
      parseGameJson(
        '{"subpackages":[{"name":"a","root":"a"},{"name":"a","root":"b"}]}',
      ).ok,
    ).toBe(false);
    expect(
      parseGameJson('{"subpackages":[{"name":"a","root":"/abs/"}]}').gameJson
        ?.subpackages[0]?.root,
    ).toBe("abs");
    expect(
      parseGameJson('{"subpackages":[{"name":"a","root":"//host/share"}]}').ok,
    ).toBe(false);
  });

  it("carries the independent flag", () => {
    const parsed = parseGameJson(
      '{"subpackages":[{"name":"a","root":"a","independent":true}]}',
    );
    expect(parsed.gameJson?.subpackages[0]?.independent).toBe(true);
  });
});

describe("validateWechatProject structure", () => {
  it("accepts a healthy project with one subpackage", async () => {
    await buildProject({
      subpackages: [{ name: "stage1", root: "stage1/", bytes: 1000 }],
    });
    const report = await validateWechatProject(wechat(), tmp);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.subpackages).toHaveLength(1);
  });

  it("flags missing game.json / game.js / project.config.json", async () => {
    await buildProject({ omit: ["game.json"] });
    expect(codes(await validateWechatProject(wechat(), tmp))).toContain(
      "WX_GAME_JSON_MISSING",
    );

    await buildProject({ omit: ["game.js"] });
    expect(codes(await validateWechatProject(wechat(), tmp))).toContain(
      "WX_GAME_ENTRY_MISSING",
    );

    await buildProject({ omit: ["project.config.json"] });
    expect(codes(await validateWechatProject(wechat(), tmp))).toContain(
      "WX_PROJECT_CONFIG_MISSING",
    );
  });

  it("flags invalid game.json", async () => {
    const project = path.join(tmp, "minigame");
    await fsp.mkdir(project, { recursive: true });
    await fsp.writeFile(path.join(project, "game.json"), "{ nope");
    const report = await validateWechatProject(wechat(), tmp);
    expect(codes(report)).toContain("WX_GAME_JSON_INVALID");
  });

  it("flags missing subpackage roots", async () => {
    await buildProject({
      subpackages: [{ name: "gone", root: "gone/", omitRoot: true }],
    });
    expect(codes(await validateWechatProject(wechat(), tmp))).toContain(
      "WX_SUBPACKAGE_ROOT_MISSING",
    );
  });

  it("flags nested subpackage roots", async () => {
    await buildProject({
      subpackages: [
        { name: "outer", root: "outer/" },
        { name: "inner", root: "outer/inner/" },
      ],
    });
    expect(codes(await validateWechatProject(wechat(), tmp))).toContain(
      "WX_SUBPACKAGE_NESTED",
    );
  });

  it("flags openDataContext overlapping a subpackage", async () => {
    await buildProject({
      subpackages: [{ name: "odd", root: "odd/" }],
      openDataContext: "odd",
    });
    expect(codes(await validateWechatProject(wechat(), tmp))).toContain(
      "WX_SUBPACKAGE_OVERLAPS_OPEN_DATA",
    );
  });

  it("accepts a js-file subpackage root", async () => {
    await buildProject({
      subpackages: [{ name: "s2", root: "stage2.js", bytes: 2048 }],
    });
    const report = await validateWechatProject(wechat(), tmp);
    expect(report.ok).toBe(true);
    expect(report.subpackages[0]?.bytes).toBe(2048);
  });

  it("rejects project.config.json appid mismatch", async () => {
    await buildProject({});
    const project = path.join(tmp, "minigame");
    await fsp.writeFile(
      path.join(project, "project.config.json"),
      JSON.stringify({ appid: "wxdifferent0000000" }),
    );
    const report = await validateWechatProject(wechat(), tmp);
    expect(report.ok).toBe(false);
    expect(codes(report)).toContain("WX_PROJECT_CONFIG_INVALID");
  });
});

describe("validateWechatProject size limits", () => {
  it("main package over 4M is an error; openDataContext counts toward main", async () => {
    await buildProject({ mainBytes: 4 * MIB + 1 });
    expect(codes(await validateWechatProject(wechat(), tmp))).toContain(
      "WX_MAIN_OVER_LIMIT",
    );

    await buildProject({ openDataContext: "odd", mainBytes: 3 * MIB });
    const project = path.join(tmp, "minigame");
    await fsp.writeFile(
      path.join(project, "odd", "big.bin"),
      Buffer.alloc(1.5 * MIB, 1),
    );
    expect(codes(await validateWechatProject(wechat(), tmp))).toContain(
      "WX_MAIN_OVER_LIMIT",
    );
  });

  it("subpackage bytes do not count toward main", async () => {
    await buildProject({
      mainBytes: 3.9 * MIB,
      subpackages: [{ name: "big", root: "big/", bytes: 20 * MIB }],
    });
    const report = await validateWechatProject(wechat(), tmp);
    expect(report.ok).toBe(true);
    expect(report.subpackages[0]?.bytes).toBeGreaterThan(20 * MIB - 1024);
    expect(report.main.bytes).toBeLessThan(4 * MIB);
  });

  it("independent subpackages are capped at 4M each", async () => {
    await buildProject({
      subpackages: [
        {
          name: "login",
          root: "login/",
          independent: true,
          bytes: 4 * MIB + 1,
        },
      ],
    });
    expect(codes(await validateWechatProject(wechat(), tmp))).toContain(
      "WX_INDEPENDENT_OVER_LIMIT",
    );
  });

  it("total over 30M is an error", async () => {
    await buildProject({
      mainBytes: 3 * MIB,
      subpackages: [
        { name: "a", root: "a/", bytes: 14 * MIB },
        { name: "b", root: "b/", bytes: 14 * MIB },
      ],
    });
    expect(codes(await validateWechatProject(wechat(), tmp))).toContain(
      "WX_TOTAL_OVER_LIMIT",
    );
  });

  it("limits are overridable (platforms change rules over time)", async () => {
    await buildProject({ mainBytes: 4 * MIB + 1 });
    const base = await validateWechatProject(wechat(), tmp);
    expect(base.ok).toBe(false);
    const relaxed = await validateWechatProject(wechat(), tmp, {
      wxMainBytes: 5 * MIB,
    });
    expect(relaxed.ok).toBe(true);
  });

  it("warns near thresholds", async () => {
    await buildProject({ mainBytes: 3.7 * MIB });
    const report = await validateWechatProject(wechat(), tmp);
    expect(report.ok).toBe(true);
    expect(report.warnings.join(" ")).toMatch(/main package/);
  });
});

describe("report richness: per-item fix suggestions and largest-files analysis", () => {
  it("every error carries subject, suggestion and (where applicable) docs", async () => {
    await buildProject({
      omit: ["game.js", "project.config.json"],
      mainBytes: 4 * MIB + 1,
    });
    const report = await validateWechatProject(wechat(), tmp);
    for (const error of report.errors) {
      expect(error.subject.length).toBeGreaterThan(0);
      expect(error.suggestion.length).toBeGreaterThan(20);
      expect(error.suggestion).toMatch(/[a-zA-Z]/);
    }
    const main = report.errors.find((e) => e.code === "WX_MAIN_OVER_LIMIT");
    expect(main?.suggestion).toMatch(/subpackage|CDN/i);
    expect(main?.subject).toBe("main package");
    const cfg = report.errors.find(
      (e) => e.code === "WX_PROJECT_CONFIG_MISSING",
    );
    expect(cfg?.suggestion).toMatch(/project\.config\.json/);
    expect(cfg?.docs ?? "").toMatch(/developers\.weixin\.qq\.com/);
  });

  it("lists the largest files of an over-limit package (project-relative posix paths, sorted)", async () => {
    const project = path.join(tmp, "minigame");
    await buildProject({ mainBytes: 3 * MIB });
    await fsp.writeFile(
      path.join(project, "huge.bundle"),
      Buffer.alloc(4 * MIB, 1),
    ); // pushes main over 4M
    const report = await validateWechatProject(wechat(), tmp);
    expect(codes(report)).toContain("WX_MAIN_OVER_LIMIT");
    const analysis = report.analysis.find((entry) => entry.package === "main");
    expect(analysis).toBeDefined();
    expect(analysis!.files[0]!.path).toBe("huge.bundle");
    expect(analysis!.files[0]!.bytes).toBe(4 * MIB);
    expect(analysis!.files[0]!.path).not.toMatch(/\\/);
    expect(analysis!.files.length).toBeLessThanOrEqual(10);
    const bytesList = analysis!.files.map((f) => f.bytes);
    expect([...bytesList].sort((a, b) => b - a)).toEqual(bytesList);
  });

  it("independent over-limit subpackages get their own analysis entry", async () => {
    await buildProject({
      subpackages: [
        {
          name: "login",
          root: "login/",
          independent: true,
          bytes: 4 * MIB + 1,
        },
      ],
    });
    const report = await validateWechatProject(wechat(), tmp);
    expect(codes(report)).toContain("WX_INDEPENDENT_OVER_LIMIT");
    const analysis = report.analysis.find(
      (entry) => entry.package === 'subpackage "login"',
    );
    expect(analysis?.files[0]?.path).toBe("login/payload.bin");
  });

  it("healthy small projects carry no analysis noise", async () => {
    await buildProject({ mainBytes: 1024 });
    const report = await validateWechatProject(wechat(), tmp);
    expect(report.ok).toBe(true);
    expect(report.analysis).toEqual([]);
  });
});

describe("formatBytes", () => {
  it("renders MiB and KiB", () => {
    expect(formatBytes(4 * MIB)).toBe("4.00M");
    expect(formatBytes(1024)).toBe("1.0K");
  });
});
