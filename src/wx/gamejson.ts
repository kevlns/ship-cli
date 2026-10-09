/** Leading / in game.json denotes the game root, not a host filesystem root. */
export function gameRelativePath(value: string): string {
  if (
    value.startsWith("//") ||
    value.includes("\\") ||
    /^[A-Za-z]:/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error("unsafe game path");
  const normalized = value.replace(/^\//, "").replace(/\/$/, "");
  if (
    !normalized ||
    normalized
      .split("/")
      .some((part) => part === ".." || part === "." || part === "")
  )
    throw new Error("unsafe game path");
  return normalized;
}

/** Normalized view of game.json (the bits this tool reasons about). */
export interface SubpackageEntry {
  name: string;
  root: string;
  independent: boolean;
}

export interface GameJson {
  deviceOrientation?: string;
  openDataContext?: string;
  workers?: string | { path: string; isSubpackage?: boolean };
  subpackages: SubpackageEntry[];
}

export interface GameJsonParseResult {
  ok: boolean;
  error?: string;
  gameJson?: GameJson;
}

/**
 * Parse + normalize game.json. Accepts both `subpackages` and `subPackages`
 * spellings (both are documented). Anything unexpected is surfaced as an
 * error string instead of being silently coerced.
 */
export function parseGameJson(text: string): GameJsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `game.json is not valid JSON: ${String(err)}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "game.json must be a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.subpackages !== undefined && obj.subPackages !== undefined)
    return { ok: false, error: "use one subpackages spelling, not both" };
  const rawSubs = obj.subpackages ?? obj.subPackages;
  if (rawSubs !== undefined && !Array.isArray(rawSubs)) {
    return { ok: false, error: "game.json subpackages must be an array" };
  }
  const subpackages: SubpackageEntry[] = [];
  for (const [index, raw] of ((rawSubs as unknown[]) ?? []).entries()) {
    if (typeof raw !== "object" || raw === null) {
      return {
        ok: false,
        error: `game.json subpackages[${index}] must be an object`,
      };
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      return {
        ok: false,
        error: `game.json subpackages[${index}].name must be a non-empty string`,
      };
    }
    if (typeof entry.root !== "string" || entry.root.length === 0) {
      return {
        ok: false,
        error: `game.json subpackages[${index}].root must be a non-empty string`,
      };
    }
    let root: string;
    try {
      root = gameRelativePath(entry.root);
    } catch {
      return {
        ok: false,
        error: `game.json subpackages[${index}].root must be a safe relative path (got "${entry.root}")`,
      };
    }
    if (
      entry.independent !== undefined &&
      typeof entry.independent !== "boolean"
    )
      return {
        ok: false,
        error: `subpackages[${index}].independent must be boolean`,
      };
    if (subpackages.some((existing) => existing.name === entry.name)) {
      return {
        ok: false,
        error: `game.json subpackages: duplicate name "${entry.name}"`,
      };
    }
    subpackages.push({
      name: entry.name,
      root,
      independent: entry.independent === true,
    });
  }
  let openDataContext: string | undefined;
  if (obj.openDataContext !== undefined) {
    if (
      typeof obj.openDataContext !== "string" ||
      obj.openDataContext.length === 0
    ) {
      return {
        ok: false,
        error: "game.json openDataContext must be a non-empty string",
      };
    }
    try {
      openDataContext = gameRelativePath(obj.openDataContext);
    } catch {
      return {
        ok: false,
        error: "game.json openDataContext must be a safe relative path",
      };
    }
  }
  let workers: GameJson["workers"];
  if (obj.workers !== undefined) {
    try {
      if (typeof obj.workers === "string")
        workers = gameRelativePath(obj.workers);
      else if (
        obj.workers &&
        typeof obj.workers === "object" &&
        !Array.isArray(obj.workers)
      ) {
        const worker = obj.workers as {
          path?: unknown;
          isSubpackage?: unknown;
        };
        if (
          typeof worker.path !== "string" ||
          (worker.isSubpackage !== undefined &&
            typeof worker.isSubpackage !== "boolean")
        )
          throw Error();
        workers = {
          path: gameRelativePath(worker.path),
          isSubpackage: worker.isSubpackage === true,
        };
      } else throw Error();
    } catch {
      return {
        ok: false,
        error:
          "workers must specify a safe directory path and optional boolean isSubpackage",
      };
    }
  }
  return {
    ok: true,
    gameJson: {
      deviceOrientation:
        typeof obj.deviceOrientation === "string"
          ? obj.deviceOrientation
          : undefined,
      openDataContext,
      workers,
      subpackages,
    },
  };
}
