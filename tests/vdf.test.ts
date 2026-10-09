import { describe, expect, it } from "vitest";
import {
  appBuildVdfName,
  depotBuildVdfName,
  escapeVdfString,
  quoteVdf,
  renderAppBuildVdf,
  renderDepotBuildVdf
} from "../src/steam/vdf.ts";

describe("escapeVdfString / quoteVdf", () => {
  it("escapes backslashes and quotes", () => {
    expect(escapeVdfString("a\\b")).toBe("a\\\\b");
    expect(escapeVdfString('say "hi"')).toBe('say \\"hi\\"');
    expect(quoteVdf("C:\\games\\x")).toBe('"C:\\\\games\\\\x"');
  });
  it("keeps ordinary values untouched", () => {
    expect(quoteVdf("beta")).toBe('"beta"');
  });
});

describe("renderAppBuildVdf", () => {
  it("renders every documented field", () => {
    const out = renderAppBuildVdf({
      appId: 1000,
      desc: 'nightly "2026-10-08"',
      contentRoot: "C:/build/steam",
      buildOutput: "C:/build/steam-out",
      setLive: "beta",
      preview: false,
      depots: [{ id: 1001, vdf: "depot_build_1001.vdf" }]
    });
    expect(out).toContain('"AppID" "1000"');
    expect(out).toContain('"Desc" "nightly \\"2026-10-08\\""');
    expect(out).toContain('"ContentRoot" "C:/build/steam/"');
    expect(out).toContain('"BuildOutput" "C:/build/steam-out/"');
    expect(out).toContain('"SetLive" "beta"');
    expect(out).toContain('"Preview" "0"');
    expect(out).toContain('"Local" ""');
    expect(out).toContain('"1001" "depot_build_1001.vdf"');
    // never invent undocumented fields
    expect(out).not.toContain("betakey");
    expect(out).not.toContain("Setup");
  });

  it("preview mode writes Preview=1 and empty setLive stays empty", () => {
    const out = renderAppBuildVdf({
      appId: 7,
      desc: "d",
      contentRoot: "/c",
      buildOutput: "/o",
      setLive: "",
      preview: true,
      depots: []
    });
    expect(out).toContain('"Preview" "1"');
    expect(out).toContain('"SetLive" ""');
  });
});

describe("renderDepotBuildVdf", () => {
  it("maps whole contentRoot with * and lists exclusions", () => {
    const out = renderDepotBuildVdf({ depotId: 1002, source: ".", exclusions: ["*.pdb", "*~*"] });
    expect(out).toContain('"DepotID" "1002"');
    expect(out).toContain('"LocalPath" "*"');
    expect(out).toContain('"DepotPath" "."');
    expect(out).toContain('"Recursive" "true"');
    expect(out).toContain('"FileExclusion" "*.pdb"');
    expect(out).toContain('"FileExclusion" "*~*"');
  });

  it("maps a subdirectory's contents onto the depot root", () => {
    const out = renderDepotBuildVdf({ depotId: 3, source: "win64", exclusions: [] });
    expect(out).toContain('"LocalPath" "win64/*"');
  });

  it("normalizes windows-style source paths", () => {
    const out = renderDepotBuildVdf({ depotId: 3, source: "win64\\sub", exclusions: [] });
    expect(out).toContain('"LocalPath" "win64/sub/*"');
  });
});

describe("file names", () => {
  it("uses steamcmd conventions", () => {
    expect(appBuildVdfName(1000)).toBe("app_build_1000.vdf");
    expect(depotBuildVdfName(1001)).toBe("depot_build_1001.vdf");
  });
});
