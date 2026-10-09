import { createHmac } from "node:crypto";
import { CliError } from "../core/errors.ts";

/**
 * Steam Guard mobile-authenticator TOTP (same algorithm as SteamDesktopAuthenticator):
 * HMAC-SHA1(base64(secret), 8-byte big-endian floor(unix/30)) -> 5 chars from
 * Steam's 25-char alphabet. The code goes into `steamcmd +login user pass <code>`.
 */
const ALPHABET = "23456789BCDFGHJKMNPQRTVWXY";

export function generateSteamTotp(secretBase64: string, timeSeconds: number): string {
  let key: Buffer;
  try {
    key = Buffer.from(secretBase64, "base64");
  } catch {
    throw new CliError("STM_TOTP_INVALID", "STEAM shared secret is not valid base64");
  }
  if (key.length === 0) {
    throw new CliError("STM_TOTP_INVALID", "STEAM shared secret decodes to zero bytes");
  }
  const timeSlice = Math.floor(timeSeconds / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(timeSlice));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = digest.readUInt32BE(offset) & 0x7fffffff;
  let out = "";
  let remaining = code;
  for (let i = 0; i < 5; i += 1) {
    out += ALPHABET[remaining % ALPHABET.length];
    remaining = Math.floor(remaining / ALPHABET.length);
  }
  return out;
}
