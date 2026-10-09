import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  buildLoginArgs,
  describeCredentialMode,
  resolveSteamCredentials,
  seedConfigVdf,
} from "../src/steam/steamcmd.ts";
import { redactSecrets, maskSecret } from "../src/core/redact.ts";
import { runProcess } from "../src/core/exec.ts";
import { resolvePrivateKey } from "../src/wx/cicli.ts";
import { CliError } from "../src/core/errors.ts";

let tmp: string;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ship-safety-"));
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

describe("credentials", () => {
  it("prefers SHIP_STEAM_* over STEAM_*", () => {
    const creds = resolveSteamCredentials({
      SHIP_STEAM_USERNAME: "ship-user",
      STEAM_USERNAME: "plain-user",
      STEAM_PASSWORD: "plain-pass",
      SHIP_STEAM_PASSWORD: "ship-pass",
    });
    expect(creds.username).toBe("ship-user");
    expect(creds.password).toBe("ship-pass");
  });

  it("does not read obsolete unprefixed credential names", () => {
    const creds = resolveSteamCredentials({
      STEAM_USERNAME: "u",
      STEAM_TOTP: "ABCDE",
    });
    expect(creds.username).toBeUndefined();
    expect(creds.totp).toBeUndefined();
  });

  it("buildLoginArgs: password + code mode", () => {
    expect(
      buildLoginArgs({ username: "u", password: "p", totp: "VWXYZ" }, 1000),
    ).toEqual(["+login", "u", "p", "VWXYZ"]);
  });

  it("buildLoginArgs: generates a code from the shared secret at run time", () => {
    const secret = Buffer.from("0123456789abcdef0123").toString("base64");
    const args = buildLoginArgs(
      { username: "u", password: "p", totpSecret: secret },
      1_759_926_000,
    );
    expect(args).toHaveLength(4);
    expect(args[3]).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
  });

  it("buildLoginArgs: passwordless mode omits both", () => {
    expect(buildLoginArgs({ username: "u" })).toEqual(["+login", "u"]);
  });

  it("buildLoginArgs: refuses missing username", () => {
    expect(() => buildLoginArgs({})).toThrow(CliError);
  });

  it("describes the credential mode for doctor", () => {
    expect(describeCredentialMode({ password: "p", totp: "T" })).toMatch(
      /password \+ TOTP/,
    );
    expect(describeCredentialMode({ password: "p" })).toMatch(/Guard/);
    expect(describeCredentialMode({})).toMatch(/passwordless/);
  });
});

describe("set-live default guard", () => {
  it("is enforced by normalizeBranch inside prepareSteamVdfs", async () => {
    const { prepareSteamVdfs } = await import("../src/commands/steam.ts");
    const { loadConfig } = await import("../src/core/config.ts");
    await fsp.writeFile(
      path.join(tmp, "ship.config.json"),
      JSON.stringify({
        schemaVersion: 1,
        steam: {
          appId: 10,
          contentRoot: "content",
          buildOutput: "out",
          depots: [{ id: 11, source: "." }],
        },
      }),
    );
    const config = await loadConfig(tmp);
    await expect(
      prepareSteamVdfs(config, {
        desc: "d",
        setLive: "default",
        preview: false,
      }),
    ).rejects.toMatchObject({ code: "STM_SETLIVE_DEFAULT" });
    await expect(
      prepareSteamVdfs(config, { desc: "d", setLive: " ", preview: false }),
    ).rejects.toMatchObject({
      code: "STM_SETLIVE_EMPTY_BRANCH",
    });
    const ok = await prepareSteamVdfs(config, {
      desc: "d",
      setLive: "beta",
      preview: false,
    });
    expect(ok.setLive).toBe("beta");
  });
});

describe("config.vdf seeding", () => {
  function fakeSteamcmdDir(): string {
    return path.join(tmp, "steamcmd", "steamcmd.exe");
  }

  it("rejects payloads that are not config.vdf", async () => {
    await expect(
      seedConfigVdf(fakeSteamcmdDir(), Buffer.from("hello").toString("base64")),
    ).rejects.toMatchObject({
      code: "STM_CONFIG_VDF_INVALID",
    });
  });

  it("writes when absent, refuses when a different file exists", async () => {
    const exe = fakeSteamcmdDir();
    await fsp.mkdir(path.dirname(exe), { recursive: true });
    await fsp.writeFile(exe, "stub");
    const payload = `"InstallConfigStore"\n{\n\t"foo" "bar"\n}\n`;
    const target = await seedConfigVdf(
      exe,
      Buffer.from(payload).toString("base64"),
    );
    await expect(fsp.readFile(target, "utf8")).resolves.toBe(payload);
    const other = Buffer.from(
      `"InstallConfigStore"\n{\n\t"foo" "baz"\n}\n`,
    ).toString("base64");
    await expect(seedConfigVdf(exe, other)).rejects.toMatchObject({
      code: "STM_CONFIG_VDF_CONFLICT",
    });
    // idempotent for identical payload
    await expect(
      seedConfigVdf(exe, Buffer.from(payload).toString("base64")),
    ).resolves.toBe(target);
  });
});

describe("redaction", () => {
  it("redactSecrets removes secrets but keeps short tokens intact", () => {
    expect(
      redactSecrets("password=hunter2boogaloo x=ab", ["hunter2boogaloo"]),
    ).toBe("password=*** x=ab");
  });

  it("maskSecret never leaks the value", () => {
    expect(maskSecret("supersecret")).toBe("***(11 chars)");
    expect(maskSecret(undefined)).toBe("(unset)");
  });

  it("runProcess redacts secrets from captured output", async () => {
    const result = await runProcess(
      process.execPath,
      ["-e", "process.stdout.write('token=abc123xyz')"],
      {
        redact: ["abc123xyz"],
      },
    );
    expect(result.stdout).not.toContain("abc123xyz");
    expect(result.stdout).toContain("***");
  }, 20000);
});

describe("wx private key resolution", () => {
  it("respects SHIP_WX_PRIVATE_KEY > config path and validates PEM", async () => {
    const keyFile = path.join(tmp, "key.pem");
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 1024,
      privateKeyEncoding: { format: "pem", type: "pkcs1" },
      publicKeyEncoding: { format: "pem", type: "pkcs1" },
    });
    await fsp.writeFile(keyFile, privateKey);

    expect(
      await resolvePrivateKey({ SHIP_WX_PRIVATE_KEY: keyFile }, undefined, tmp),
    ).toBe(keyFile);
    await expect(
      resolvePrivateKey({ WX_UPLOAD_KEY: keyFile }, undefined, tmp),
    ).rejects.toMatchObject({ code: "WX_KEY_NOT_FOUND" });
    expect(await resolvePrivateKey({}, keyFile, tmp)).toBe(keyFile);
    expect(
      await resolvePrivateKey(
        { SHIP_WX_PRIVATE_KEY: keyFile, WX_UPLOAD_KEY: "other" },
        undefined,
        tmp,
      ),
    ).toBe(keyFile);
  });

  it("fails closed on missing or non-PEM keys", async () => {
    await expect(resolvePrivateKey({}, undefined, tmp)).rejects.toMatchObject({
      code: "WX_KEY_NOT_FOUND",
    });
    await expect(
      resolvePrivateKey({}, path.join(tmp, "nope.pem"), tmp),
    ).rejects.toMatchObject({
      code: "WX_KEY_NOT_FOUND",
    });
    const bad = path.join(tmp, "bad.pem");
    await fsp.writeFile(bad, "not a pem");
    await expect(resolvePrivateKey({}, bad, tmp)).rejects.toMatchObject({
      code: "WX_KEY_INVALID",
    });
  });
});
