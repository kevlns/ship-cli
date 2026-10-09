import fsp from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_WX_LIMITS,
  type LimitsConfig,
  type WechatConfig,
} from "../core/config.ts";
import type { ShipErrorCode } from "../core/errors.ts";
import { CliError } from "../core/errors.ts";
import { suggest } from "../core/suggest.ts";
import { safeJoin, isInsidePath, isDirectory, isFile } from "../core/fsx.ts";
import { parseGameJson, type SubpackageEntry } from "./gamejson.ts";
import { fileSelector } from "./files.ts";

export interface ValidationProblem {
  code: ShipErrorCode;
  /** Where the problem lives, e.g. 'main package' or 'subpackage "stage1"'. */
  subject: string;
  message: string;
  suggestion: string;
  docs?: string;
}

export interface PackageMeasure {
  files: number;
  bytes: number;
  limitBytes?: number;
}

export interface SubpackageMeasure extends PackageMeasure {
  name: string;
  root: string;
  independent: boolean;
  rootExists: boolean;
  limitBytes?: number;
}

export interface LargeFileEntry {
  /** Project-relative path with forward slashes. */
  path: string;
  bytes: number;
}

export interface PackageAnalysis {
  package: string;
  files: LargeFileEntry[];
}

export interface WxValidationReport {
  measurement: "filtered-source-estimate";
  ok: boolean;
  projectPath: string;
  appid: string;
  limits: { main: number; independent: number; total: number };
  main: PackageMeasure;
  subpackages: SubpackageMeasure[];
  total: PackageMeasure;
  openDataContext: { dir: string; files: number; bytes: number } | null;
  errors: ValidationProblem[];
  warnings: string[];
  /** Top largest files for packages at/over their limits — the "what to move" answer. */
  analysis: PackageAnalysis[];
}

const WARN_RATIO = 0.9;
const ANALYSIS_TOP_N = 10;

function problem(
  code: ShipErrorCode,
  subject: string,
  message: string,
  override?: { suggestion?: string },
): ValidationProblem {
  const fix = suggest(code);
  return {
    code,
    subject,
    message,
    suggestion: override?.suggestion ?? fix.suggestion,
    ...(fix.docs !== undefined ? { docs: fix.docs } : {}),
  };
}

export async function validateWechatProject(
  wechat: WechatConfig,
  projectRoot: string,
  limitsOverride?: LimitsConfig,
): Promise<WxValidationReport> {
  const limits = {
    main: limitsOverride?.wxMainBytes ?? DEFAULT_WX_LIMITS.wxMainBytes,
    independent:
      limitsOverride?.wxIndependentSubpackageBytes ??
      DEFAULT_WX_LIMITS.wxIndependentSubpackageBytes,
    total: limitsOverride?.wxTotalBytes ?? DEFAULT_WX_LIMITS.wxTotalBytes,
  };
  const projectPath = safeJoin(projectRoot, wechat.projectPath);
  const errors: ValidationProblem[] = [];
  const warnings: string[] = [];
  const analysis: PackageAnalysis[] = [];
  const emptyReport = (
    code: ShipErrorCode,
    message: string,
  ): WxValidationReport => ({
    measurement: "filtered-source-estimate",
    ok: false,
    projectPath,
    appid: wechat.appid,
    limits,
    main: { files: 0, bytes: 0 },
    subpackages: [],
    total: { files: 0, bytes: 0 },
    openDataContext: null,
    errors: [problem(code, "project", message)],
    warnings,
    analysis,
  });

  if (!(await isDirectory(projectPath))) {
    return emptyReport(
      "WX_PROJECT_DIR_MISSING",
      `projectPath does not exist or is not a directory: ${projectPath}`,
    );
  }

  const gameJsonPath = path.join(projectPath, "game.json");
  let gameJsonText: string;
  try {
    gameJsonText = await fsp.readFile(gameJsonPath, "utf8");
  } catch {
    return emptyReport(
      "WX_GAME_JSON_MISSING",
      `game.json not found at ${gameJsonPath}`,
    );
  }
  const parsed = parseGameJson(gameJsonText);
  if (!parsed.ok || parsed.gameJson === undefined) {
    return emptyReport(
      "WX_GAME_JSON_INVALID",
      parsed.error ?? "game.json is invalid",
    );
  }
  const gameJson = parsed.gameJson;

  if (!(await isFile(path.join(projectPath, "game.js")))) {
    errors.push(
      problem(
        "WX_GAME_ENTRY_MISSING",
        "main package",
        "main package entry game.js is missing",
      ),
    );
  }
  let projectConfig: Record<string, unknown> = {};
  if (!(await isFile(path.join(projectPath, "project.config.json")))) {
    errors.push(
      problem(
        "WX_PROJECT_CONFIG_MISSING",
        "project",
        "project.config.json is missing (miniprogram-ci needs it; the Unity convertor normally emits it)",
      ),
    );
  } else {
    try {
      projectConfig = JSON.parse(
        await fsp.readFile(
          path.join(projectPath, "project.config.json"),
          "utf8",
        ),
      );
      if (
        !projectConfig ||
        typeof projectConfig !== "object" ||
        Array.isArray(projectConfig) ||
        projectConfig.appid !== wechat.appid ||
        projectConfig.compileType !== "game"
      )
        throw Error(
          "project.config.json must be an object with matching appid and compileType=game",
        );
    } catch (err) {
      errors.push(
        problem(
          "WX_PROJECT_CONFIG_INVALID",
          "project.config.json",
          String(err),
        ),
      );
    }
  }
  let include: (file: string) => boolean;
  try {
    include = fileSelector(projectConfig, wechat.ignores);
  } catch (err) {
    return emptyReport("WX_PROJECT_CONFIG_INVALID", String(err));
  }
  for (const required of ["game.js", "game.json"])
    if (!include(required))
      errors.push(
        problem(
          "WX_GAME_ENTRY_MISSING",
          required,
          `${required} is excluded from the package`,
        ),
      );

  // Resolve subpackage roots and enforce structural rules.
  const resolvedSubs: Array<{
    entry: SubpackageEntry;
    abs: string;
    isJsFile: boolean;
    exists: boolean;
  }> = [];
  for (const entry of gameJson.subpackages) {
    const abs = safeJoin(projectPath, entry.root);
    if (!isInsidePath(projectPath, abs)) {
      errors.push(
        problem(
          "WX_SUBPACKAGE_ROOT_OUTSIDE",
          `subpackage "${entry.name}"`,
          `root escapes projectPath: ${entry.root}`,
        ),
      );
      continue;
    }
    const isJsFile = /\.js$/i.test(entry.root);
    const exists = isJsFile ? await isFile(abs) : await isDirectory(abs);
    if (!exists) {
      errors.push(
        problem(
          "WX_SUBPACKAGE_ROOT_MISSING",
          `subpackage "${entry.name}"`,
          `root does not exist: ${entry.root}`,
        ),
      );
    } else if (
      (isJsFile && !include(entry.root)) ||
      (!isJsFile &&
        (!(await isFile(path.join(abs, "game.js"))) ||
          !include(`${entry.root}/game.js`)))
    ) {
      errors.push(
        problem(
          "WX_GAME_ENTRY_MISSING",
          entry.root,
          `subpackage "${entry.name}" has no game.js at its root`,
        ),
      );
    }
    resolvedSubs.push({ entry, abs, isJsFile, exists });
  }
  for (let i = 0; i < resolvedSubs.length; i += 1) {
    for (let j = i + 1; j < resolvedSubs.length; j += 1) {
      const a = resolvedSubs[i]!;
      const b = resolvedSubs[j]!;
      if (isInsidePath(a.abs, b.abs) || isInsidePath(b.abs, a.abs)) {
        errors.push(
          problem(
            "WX_SUBPACKAGE_NESTED",
            `subpackages "${a.entry.name}" + "${b.entry.name}"`,
            "subpackage roots must not nest or overlap",
          ),
        );
      }
    }
  }

  let openDataContext: WxValidationReport["openDataContext"] = null;
  if (gameJson.openDataContext !== undefined) {
    const oddAbs = safeJoin(projectPath, gameJson.openDataContext);
    if (!isInsidePath(projectPath, oddAbs)) {
      errors.push(
        problem(
          "WX_SUBPACKAGE_ROOT_OUTSIDE",
          "openDataContext",
          `openDataContext escapes projectPath: ${gameJson.openDataContext}`,
        ),
      );
    } else {
      if (!(await isDirectory(oddAbs))) {
        errors.push(
          problem(
            "WX_GAME_ENTRY_MISSING",
            "openDataContext",
            `directory does not exist: ${gameJson.openDataContext}`,
          ),
        );
      }
      if (!(await isFile(path.join(oddAbs, "index.js"))))
        errors.push(
          problem(
            "WX_GAME_ENTRY_MISSING",
            "openDataContext",
            "index.js is missing",
          ),
        );
      for (const sub of resolvedSubs) {
        if (isInsidePath(sub.abs, oddAbs) || isInsidePath(oddAbs, sub.abs)) {
          errors.push(
            problem(
              "WX_SUBPACKAGE_OVERLAPS_OPEN_DATA",
              `openDataContext vs subpackage "${sub.entry.name}"`,
              "openDataContext must not overlap any subpackage",
            ),
          );
        }
      }
      if (await isDirectory(oddAbs)) {
        const measured = await walkTree(oddAbs, {
          relBase: projectPath,
          include,
          ignores: wechat.ignores,
        });
        openDataContext = {
          dir: gameJson.openDataContext,
          files: measured.files,
          bytes: measured.bytes,
        };
      }
    }
  }
  if (gameJson.workers) {
    const worker =
      typeof gameJson.workers === "string"
        ? { path: gameJson.workers, isSubpackage: false }
        : gameJson.workers;
    const abs = safeJoin(projectPath, worker.path);
    if (!(await isDirectory(abs)))
      errors.push(
        problem(
          "WX_WORKERS_INVALID",
          worker.path,
          "workers directory is missing",
        ),
      );
    if (worker.isSubpackage) {
      if (
        resolvedSubs.some(
          (sub) => isInsidePath(sub.abs, abs) || isInsidePath(abs, sub.abs),
        ) ||
        (gameJson.openDataContext &&
          (isInsidePath(abs, safeJoin(projectPath, gameJson.openDataContext)) ||
            isInsidePath(safeJoin(projectPath, gameJson.openDataContext), abs)))
      )
        errors.push(
          problem(
            "WX_WORKERS_INVALID",
            worker.path,
            "worker package overlaps another package or open data context",
          ),
        );
      else
        resolvedSubs.push({
          entry: { name: "__WORKERS__", root: worker.path, independent: false },
          abs,
          isJsFile: false,
          exists: await isDirectory(abs),
        });
    }
  }

  // Size measurement: main = everything outside subpackage roots (open data
  // context counts toward the main package per official docs).
  const subRoots = resolvedSubs.map((s) => s.abs);
  const mainWalk = await walkTree(projectPath, {
    skip: (abs) => subRoots.some((root) => isInsidePath(root, abs)),
    relBase: projectPath,
    include,
    ignores: wechat.ignores,
  });
  const main: PackageMeasure = {
    files: mainWalk.files,
    bytes: mainWalk.bytes,
    limitBytes: limits.main,
  };
  const subpackages: SubpackageMeasure[] = [];
  const subWalks = new Map<string, WalkResult>();
  for (const sub of resolvedSubs) {
    if (!sub.exists) {
      subpackages.push({
        name: sub.entry.name,
        root: sub.entry.root,
        independent: sub.entry.independent,
        rootExists: false,
        files: 0,
        bytes: 0,
      });
      continue;
    }
    const walked = sub.isJsFile
      ? {
          files: 1,
          bytes: (await fsp.stat(sub.abs)).size,
          entries: [
            {
              path: toPosix(path.relative(projectPath, sub.abs)),
              bytes: (await fsp.stat(sub.abs)).size,
            },
          ],
        }
      : await walkTree(sub.abs, {
          relBase: projectPath,
          include,
          ignores: wechat.ignores,
        });
    subWalks.set(sub.entry.name, walked);
    subpackages.push({
      name: sub.entry.name,
      root: sub.entry.root,
      independent: sub.entry.independent,
      rootExists: true,
      files: walked.files,
      bytes: walked.bytes,
      ...(sub.entry.independent ? { limitBytes: limits.independent } : {}),
    });
  }

  const totalBytes =
    main.bytes + subpackages.reduce((sum, s) => sum + s.bytes, 0);
  const totalFiles =
    main.files + subpackages.reduce((sum, s) => sum + s.files, 0);
  const total: PackageMeasure = {
    files: totalFiles,
    bytes: totalBytes,
    limitBytes: limits.total,
  };

  if (main.bytes > limits.main) {
    errors.push(
      problem(
        "WX_MAIN_OVER_LIMIT",
        "main package",
        `main package is ${formatBytes(main.bytes)} but the limit is ${formatBytes(limits.main)}`,
      ),
    );
  } else if (main.bytes >= limits.main * WARN_RATIO) {
    warnings.push(
      `main package is at ${Math.round((main.bytes / limits.main) * 100)}% of the limit`,
    );
  }
  for (const sub of subpackages) {
    if (sub.independent && sub.bytes > limits.independent) {
      errors.push(
        problem(
          "WX_INDEPENDENT_OVER_LIMIT",
          `subpackage "${sub.name}" (independent)`,
          `size is ${formatBytes(sub.bytes)} but the limit is ${formatBytes(limits.independent)}`,
        ),
      );
    }
  }
  if (totalBytes > limits.total) {
    errors.push(
      problem(
        "WX_TOTAL_OVER_LIMIT",
        "total package",
        `total size is ${formatBytes(totalBytes)} but the limit is ${formatBytes(limits.total)}`,
      ),
    );
  } else if (totalBytes >= limits.total * WARN_RATIO) {
    warnings.push(
      `total package size is at ${Math.round((totalBytes / limits.total) * 100)}% of the limit`,
    );
  }

  // Largest-files analysis for packages at/over their limits: the concrete
  // "what to move" answer size errors need.
  if (main.bytes >= limits.main * WARN_RATIO) {
    analysis.push({
      package: "main",
      files: topEntries(mainWalk.entries, ANALYSIS_TOP_N),
    });
  }
  for (const sub of subpackages) {
    const overIndependent =
      sub.independent && sub.bytes >= limits.independent * WARN_RATIO;
    if (overIndependent) {
      const walked = subWalks.get(sub.name);
      if (walked !== undefined)
        analysis.push({
          package: `subpackage "${sub.name}"`,
          files: topEntries(walked.entries, ANALYSIS_TOP_N),
        });
    }
  }
  if (totalBytes >= limits.total * WARN_RATIO) {
    const largest = [...subpackages].sort((a, b) => b.bytes - a.bytes)[0];
    if (
      largest !== undefined &&
      !analysis.some(
        (entry) => entry.package === `subpackage "${largest.name}"`,
      )
    ) {
      const walked = subWalks.get(largest.name);
      if (walked !== undefined)
        analysis.push({
          package: `subpackage "${largest.name}" (largest)`,
          files: topEntries(walked.entries, ANALYSIS_TOP_N),
        });
    }
  }

  return {
    measurement: "filtered-source-estimate",
    ok: errors.length === 0,
    projectPath,
    appid: wechat.appid,
    limits,
    main,
    subpackages,
    total,
    openDataContext,
    errors,
    warnings,
    analysis,
  };
}

interface WalkResult {
  files: number;
  bytes: number;
  entries: LargeFileEntry[];
}

async function walkTree(
  root: string,
  opts: {
    skip?: (abs: string) => boolean;
    relBase?: string;
    include?: (relative: string) => boolean;
    ignores?: string[];
  } = {},
): Promise<WalkResult> {
  const relBase = opts.relBase ?? root;
  let files = 0;
  let bytes = 0;
  const entries: LargeFileEntry[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    let dirents: import("node:fs").Dirent[];
    try {
      dirents = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      throw new CliError(
        "WX_CONTENT_UNREADABLE",
        `cannot read directory: ${current}`,
      );
    }
    for (const entry of dirents) {
      const full = path.join(current, entry.name);
      if (opts.skip !== undefined && opts.skip(full)) continue;
      const relative = toPosix(path.relative(relBase, full));
      if (
        (entry.isDirectory() || entry.isSymbolicLink()) &&
        (opts.ignores ?? ["node_modules/**/*"]).some((pattern) => {
          if (!pattern.endsWith("/**/*")) return false;
          const prefix = pattern.slice(0, -5);
          return (
          ![...prefix].some(char => "?*[{}".includes(char)) &&
            (relative === prefix || relative.startsWith(`${prefix}/`))
          );
        })
      )
        continue;
      if (entry.isSymbolicLink())
        throw new CliError(
          "WX_CONTENT_UNREADABLE",
          `packaged content contains a link: ${full}`,
        );
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        if (
          opts.include &&
          !opts.include(toPosix(path.relative(relBase, full)))
        )
          continue;
        let size = 0;
        try {
          size = (await fsp.stat(full)).size;
        } catch {
          throw new CliError(
            "WX_CONTENT_UNREADABLE",
            `cannot measure file: ${full}`,
          );
        }
        files += 1;
        bytes += size;
        entries.push({
          path: toPosix(path.relative(relBase, full)),
          bytes: size,
        });
      }
    }
  }
  return { files, bytes, entries };
}

function topEntries(
  entries: LargeFileEntry[],
  count: number,
): LargeFileEntry[] {
  return [...entries].sort((a, b) => b.bytes - a.bytes).slice(0, count);
}

function toPosix(input: string): string {
  return input.replace(/\\/g, "/");
}

export function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  if (mib >= 1) return `${mib.toFixed(2)}M`;
  return `${(bytes / 1024).toFixed(1)}K`;
}
