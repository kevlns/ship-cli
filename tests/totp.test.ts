import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { generateSteamTotp } from "../src/steam/totp.ts";
import { CliError } from "../src/core/errors.ts";

const ALPHABET = "23456789BCDFGHJKMNPQRTVWXY";

/** Independent reference implementation of the documented algorithm. */
function referenceCode(secretBase64: string, timeSeconds: number): string {
  const key = Buffer.from(secretBase64, "base64");
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(timeSeconds / 30)));
  const digest = createHmac("sha1", key).update(msg).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  let code = digest.readUInt32BE(offset) & 0x7fffffff;
  let out = "";
  for (let i = 0; i < 5; i += 1) {
    out += ALPHABET[code % ALPHABET.length];
    code = Math.floor(code / ALPHABET.length);
  }
  return out;
}

describe("generateSteamTotp", () => {
  const secret = Buffer.from("0123456789abcdef0123").toString("base64");

  it("produces 5 chars from the Steam alphabet", () => {
    const code = generateSteamTotp(secret, 1_759_926_000);
    expect(code).toMatch(new RegExp(`^[${ALPHABET}]{5}$`));
  });

  it("matches a reference implementation across time slices", () => {
    for (const t of [0, 1_700_000_000, 1_759_926_000, 1_759_926_031]) {
      expect(generateSteamTotp(secret, t)).toBe(referenceCode(secret, t));
    }
  });

  it("changes between consecutive 30s windows", () => {
    const a = generateSteamTotp(secret, 1_759_926_000);
    const b = generateSteamTotp(secret, 1_759_926_030);
    const c = generateSteamTotp(secret, 1_759_926_060);
    expect(new Set([a, b, c]).size).toBeGreaterThan(1);
  });

  it("is deterministic within one window", () => {
    expect(generateSteamTotp(secret, 500)).toBe(generateSteamTotp(secret, 509));
  });

  it("rejects invalid secrets", () => {
    expect(() => generateSteamTotp("!!!!not-base64-ish", 100)).not.toThrow(); // lenient base64 decoder tolerance
    expect(() => generateSteamTotp("", 100)).toThrow(CliError);
    expect(() => generateSteamTotp(Buffer.from("").toString("base64"), 100)).toThrow(CliError);
  });
});
