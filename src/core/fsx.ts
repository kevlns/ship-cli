import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors.ts";

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isFile();
  } catch {
    return false;
  }
}

/** True when `target` equals `base` or lies anywhere below it. */
export function isInsidePath(base: string, target: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  );
}

/** Resolve existing ancestors, including junctions, without requiring the leaf to exist. */
export function actualPath(target: string): string {
  let current = path.resolve(target);
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...tail);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // A dangling link is not a missing directory we may safely create.
      try {
        if (fs.lstatSync(current).isSymbolicLink())
          throw new CliError(
            "PAT_ESCAPE",
            `dangling directory link: ${current}`,
          );
      } catch (linkErr) {
        if ((linkErr as NodeJS.ErrnoException).code !== "ENOENT") throw linkErr;
      }
      const parent = path.dirname(current);
      if (parent === current) throw err;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

export function assertRelativePath(segment: string): void {
  if (
    !segment ||
    [...segment].some((char) => char.charCodeAt(0) < 32) ||
    path.posix.isAbsolute(segment) ||
    path.win32.isAbsolute(segment) ||
    /^[A-Za-z]:/.test(segment) ||
    segment.split(/[/\\]/).includes("..")
  ) {
    throw new CliError(
      "PAT_ESCAPE",
      `expected a safe relative path: ${segment}`,
    );
  }
}

/** Resolve `segment` under `base` and refuse anything that escapes base. */
export function safeJoin(base: string, segment: string): string {
  assertRelativePath(segment);
  const resolved = path.resolve(base, segment.replace(/[/\\]/g, path.sep));
  if (
    !isInsidePath(base, resolved) ||
    !isInsidePath(actualPath(base), actualPath(resolved))
  ) {
    throw new CliError(
      "PAT_ESCAPE",
      `resolved path escapes the allowed base: ${resolved} (base: ${path.resolve(base)})`,
    );
  }
  return resolved;
}

/** Atomic file write: temp file in the same directory, then rename. */
export async function atomicWriteFile(
  target: string,
  data: string | Buffer,
): Promise<void> {
  try {
    if ((await fsp.lstat(target)).isSymbolicLink())
      throw new CliError(
        "PAT_ESCAPE",
        `refusing to replace a linked file: ${target}`,
      );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  await fsp.writeFile(tmp, data);
  try {
    await fsp.rename(tmp, target);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

/** Expand a leading `~` to the user home directory. */
export function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(homedir(), input.slice(2));
  }
  return input;
}

function homedir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? "";
}

/** Open a URL with the platform default handler (fire and forget). */
export async function openUrl(url: string): Promise<void> {
  const cmd =
    process.platform === "win32"
      ? "cmd"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
