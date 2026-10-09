import { describe, expect, it } from "vitest";
import { analyzeSteamcmdOutput } from "../src/steam/logparse.ts";

describe("analyzeSteamcmdOutput", () => {
  it("success requires a completed app build with its BuildID", () => {
    const out = analyzeSteamcmdOutput(
      "Successfully finished AppID 1000 build (BuildID 1234567890).\n",
      "",
      0,
      { appId: 1000, preview: false },
    );
    expect(out.status).toBe("success");
    expect(out.buildId).toBe("1234567890");
  });

  it("ERROR! lines fail even with exit code 0 (steamcmd exit codes are unreliable)", () => {
    const out = analyzeSteamcmdOutput(
      "ERROR! Failed to get application info for app 1000",
      "",
      0,
    );
    expect(out.status).toBe("failed");
    expect(out.hints.length).toBeGreaterThan(0);
  });

  it("depot build status 6 failure maps to a hint", () => {
    const out = analyzeSteamcmdOutput(
      "ERROR! Failed 'DepotBuild for depot_build_1001.vdf' - status = 6.",
      "",
      0,
    );
    expect(out.status).toBe("failed");
  });

  it("login failures fail with credential hints", () => {
    const out = analyzeSteamcmdOutput(
      "ERROR! Login Failure: Account Login Denied Failed.",
      "",
      0,
    );
    expect(out.status).toBe("failed");
    expect(out.hints.join(" ")).toMatch(/Steam Guard|credentials/);
  });

  it("invalid content configuration fails", () => {
    const out = analyzeSteamcmdOutput("Invalid content configuration", "", 1);
    expect(out.status).toBe("failed");
  });

  it("non-zero exit without error signature fails", () => {
    const out = analyzeSteamcmdOutput("some output", "", 7);
    expect(out.status).toBe("failed");
  });

  it("exit 0 with no success marker is unknown (fail-closed)", () => {
    const out = analyzeSteamcmdOutput(
      "Logging in user 'bot'... OK\nDownloading update...",
      "",
      0,
    );
    expect(out.status).toBe("unknown");
    expect(out.hints.length).toBeGreaterThan(0);
  });

  it("login success is not a completed build", () => {
    const out = analyzeSteamcmdOutput("Success. Logged in OK\n", "", 0);
    expect(out.status).toBe("unknown");
    expect(out.buildId).toBeUndefined();
  });
  it("requires the expected AppID and distinguishes preview completion", () => {
    expect(
      analyzeSteamcmdOutput(
        "Successfully finished AppID 1001 build (BuildID 42).",
        "",
        0,
        { appId: 1000, preview: false },
      ).status,
    ).toBe("unknown");
    expect(
      analyzeSteamcmdOutput(
        "Successfully finished AppID 1000 build preview.",
        "",
        0,
        { appId: 1000, preview: true },
      ).status,
    ).toBe("success");
    expect(
      analyzeSteamcmdOutput(
        "Successfully finished AppID 1000 build preview.",
        "",
        0,
        { appId: 1000, preview: false },
      ).status,
    ).toBe("unknown");
    expect(
      analyzeSteamcmdOutput(
        "Success. Logged in OK\nERROR: Failed to upload",
        "",
        0,
      ).status,
    ).toBe("failed");
  });
});
