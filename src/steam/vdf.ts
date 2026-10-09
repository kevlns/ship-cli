/**
 * VDF (Valve Data Format) generation for SteamPipe builds.
 *
 * Grammar per Valve KeyValues: `"key" "value"` pairs, `{}` blocks, `//` line
 * comments, escape sequences \n \t \\ \". Generator policy: always quote,
 * always escape `\` and `"` in values, duplicate keys carry list semantics
 * (FileMapping / FileExclusion). Field set is limited to what Valve documents
 * for AppBuild / DepotBuildConfig (see docs/research/steam.md); do not invent
 * fields like `betakey` or `Setup`.
 */

export function escapeVdfString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

export function quoteVdf(value: string): string {
  return `"${escapeVdfString(value)}"`;
}

/** Normalize path separators for VDF output (forward slashes work on every platform's steamcmd). */
function vdfPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export interface AppBuildVdfInput {
  appId: number;
  desc: string;
  /** Absolute content root. */
  contentRoot: string;
  /** Absolute build output directory (logs + chunk cache). */
  buildOutput: string;
  /** Branch to set live automatically after a successful build. "" = none. "default" is rejected upstream. */
  setLive: string;
  /** Preview mode: upload nothing, only produce logs + manifest. */
  preview: boolean;
  /** depotId -> depot vdf file name (relative to the app build vdf's directory). */
  depots: Array<{ id: number; vdf: string }>;
}

export function renderAppBuildVdf(input: AppBuildVdfInput): string {
  const lines: string[] = [];
  lines.push('"AppBuild"');
  lines.push("{");
  lines.push(`\t"AppID" "${input.appId}"`);
  lines.push(`\t"Desc" ${quoteVdf(input.desc)}`);
  lines.push(`\t"ContentRoot" ${quoteVdf(vdfPath(input.contentRoot) + "/")}`);
  lines.push(`\t"BuildOutput" ${quoteVdf(vdfPath(input.buildOutput) + "/")}`);
  lines.push(`\t"SetLive" ${quoteVdf(input.setLive)}`);
  lines.push(`\t"Preview" "${input.preview ? "1" : "0"}"`);
  lines.push(`\t"Local" ""`);
  lines.push("");
  lines.push('\t"Depots"');
  lines.push("\t{");
  for (const depot of input.depots) {
    lines.push(`\t\t"${depot.id}" ${quoteVdf(depot.vdf)}`);
  }
  lines.push("\t}");
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

export interface DepotBuildVdfInput {
  depotId: number;
  /** Directory inside contentRoot whose CONTENTS map to the depot root. "." = whole contentRoot. */
  source: string;
  exclusions: string[];
}

export function renderDepotBuildVdf(input: DepotBuildVdfInput): string {
  // Mapping "<source>/*" -> "." with recursive=true flattens the source
  // directory's contents onto the depot root (game-ci/steam-deploy convention).
  const localPath = input.source === "." ? "*" : `${vdfPath(input.source)}/*`;
  const lines: string[] = [];
  lines.push('"DepotBuild"');
  lines.push("{");
  lines.push(`\t"DepotID" "${input.depotId}"`);
  lines.push("");
  lines.push('\t"FileMapping"');
  lines.push("\t{");
  lines.push(`\t\t"LocalPath" ${quoteVdf(localPath)}`);
  lines.push(`\t\t"DepotPath" "."`);
  lines.push(`\t\t"Recursive" "true"`);
  lines.push("\t}");
  for (const exclusion of input.exclusions) {
    lines.push(`\t"FileExclusion" ${quoteVdf(exclusion)}`);
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

export function appBuildVdfName(appId: number): string {
  return `app_build_${appId}.vdf`;
}

export function depotBuildVdfName(depotId: number): string {
  return `depot_build_${depotId}.vdf`;
}
