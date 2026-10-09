import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  CONFIG_FILE_NAME,
  CONFIG_TEMPLATE,
  findConfigFile,
  loadConfig,
  writeConfigTemplate
} from "../src/core/config.ts";
import { assertSchema, validateAgainstSchema } from "../src/core/schema.ts";

let tmp: string;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ship-config-"));
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

async function writeConfig(doc: unknown, dir = tmp): Promise<string> {
  const file = path.join(dir, CONFIG_FILE_NAME);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, typeof doc === "string" ? doc : JSON.stringify(doc, null, 2));
  return file;
}

describe("template + schema", () => {
  it("the shipped template passes the schema", () => {
    expect(validateAgainstSchema(CONFIG_TEMPLATE, "ship-config.schema.json")).toEqual([]);
  });

  it("rejects wrong schemaVersion and unknown platforms", () => {
    expect(validateAgainstSchema({ schemaVersion: 2 }, "ship-config.schema.json").length).toBeGreaterThan(0);
    expect(
      validateAgainstSchema(
        { schemaVersion: 1, steam: { appId: 1, contentRoot: "a", buildOutput: "b", depots: [] } },
        "ship-config.schema.json"
      ).length
    ).toBeGreaterThan(0);
  });

  it("rejects bad wechat appid shape", () => {
    expect(
      validateAgainstSchema(
        { schemaVersion: 1, wechat: { appid: "not-an-appid", projectPath: "x" } },
        "ship-config.schema.json"
      ).length
    ).toBeGreaterThan(0);
  });

  it("rejects absolute or .. relative paths", () => {
    expect(
      validateAgainstSchema(
        { schemaVersion: 1, wechat: { appid: "wx0123456789abcdef", projectPath: "/abs" } },
        "ship-config.schema.json"
      ).length
    ).toBeGreaterThan(0);
    expect(
      validateAgainstSchema(
        { schemaVersion: 1, wechat: { appid: "wx0123456789abcdef", projectPath: "../up" } },
        "ship-config.schema.json"
      ).length
    ).toBeGreaterThan(0);
  });
});

describe("findConfigFile", () => {
  it("finds the config by walking up", async () => {
    await writeConfig(CONFIG_TEMPLATE);
    const nested = path.join(tmp, "a", "b", "c");
    await fsp.mkdir(nested, { recursive: true });
    expect(await findConfigFile(nested)).toBe(path.join(tmp, CONFIG_FILE_NAME));
  });

  it("returns undefined when absent", async () => {
    expect(await findConfigFile(tmp)).toBeUndefined();
  });
});

describe("loadConfig cross-field validation", () => {
  it("loads a full config and resolves projectRoot", async () => {
    await writeConfig(CONFIG_TEMPLATE);
    const config = await loadConfig(tmp);
    expect(config.projectRoot).toBe(tmp);
    expect(config.steam?.appId).toBe(1000000);
    expect(config.wechat?.appid).toBe("wx0000000000000000");
  });

  it("fails on invalid JSON with CFG_CONFIG_INVALID_JSON", async () => {
    await writeConfig("{ nope");
    await expect(loadConfig(tmp)).rejects.toMatchObject({ code: "CFG_CONFIG_INVALID_JSON" });
  });

  it("fails when no platform section exists", async () => {
    await writeConfig({ schemaVersion: 1 });
    await expect(loadConfig(tmp)).rejects.toMatchObject({ code: "CFG_SCHEMA_INVALID" });
  });

  it("fails when config is missing entirely", async () => {
    await expect(loadConfig(tmp)).rejects.toMatchObject({ code: "CFG_CONFIG_NOT_FOUND" });
  });

  it("fails when buildOutput is inside contentRoot", async () => {
    await writeConfig({
      schemaVersion: 1,
      steam: { appId: 10, contentRoot: "build/steam", buildOutput: "build/steam/out", depots: [{ id: 11, source: "." }] }
    });
    await expect(loadConfig(tmp)).rejects.toMatchObject({ code: "CFG_CONFIG_PATH_CONFLICT" });
  });

  it("fails when contentRoot is inside buildOutput", async () => {
    await writeConfig({
      schemaVersion: 1,
      steam: { appId: 10, contentRoot: "build/out/steam", buildOutput: "build/out", depots: [{ id: 11, source: "." }] }
    });
    await expect(loadConfig(tmp)).rejects.toMatchObject({ code: "CFG_CONFIG_PATH_CONFLICT" });
  });

  it("fails on duplicate depot ids", async () => {
    await writeConfig({
      schemaVersion: 1,
      steam: {
        appId: 10,
        contentRoot: "build/steam",
        buildOutput: "build/out",
        depots: [
          { id: 11, source: "." },
          { id: 11, source: "x" }
        ]
      }
    });
    await expect(loadConfig(tmp)).rejects.toMatchObject({ code: "CFG_DEPOT_DUPLICATE_ID" });
  });

  it("blocks depot sources trying to escape contentRoot (schema rejects .. segments first)", async () => {
    await writeConfig({
      schemaVersion: 1,
      steam: {
        appId: 10,
        contentRoot: "build/steam",
        buildOutput: "build/out",
        depots: [{ id: 11, source: "../secret" }]
      }
    });
    await expect(loadConfig(tmp)).rejects.toMatchObject({ code: "CFG_SCHEMA_INVALID" });
  });
});

describe("writeConfigTemplate", () => {
  it("refuses to overwrite without force and writes atomically with it", async () => {
    const target = path.join(tmp, CONFIG_FILE_NAME);
    await writeConfigTemplate(target, false);
    await expect(writeConfigTemplate(target, false)).rejects.toMatchObject({ code: "CFG_CONFIG_EXISTS" });
    await writeConfigTemplate(target, true);
    const doc = JSON.parse(await fsp.readFile(target, "utf8")) as unknown;
    assertSchema(CONFIG_FILE_NAME, doc, "ship-config.schema.json");
  });
});
