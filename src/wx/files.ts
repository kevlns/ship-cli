import { minimatch } from "minimatch";
import { CliError } from "../core/errors.ts";

interface Rule {
  type: string;
  value: string;
}
export function fileSelector(
  projectConfig: Record<string, unknown>,
  ignores: string[] = ["node_modules/**/*"],
): (relative: string) => boolean {
  const options = projectConfig.packOptions;
  if (
    options !== undefined &&
    (!options || typeof options !== "object" || Array.isArray(options))
  )
    throw new CliError(
      "WX_PROJECT_CONFIG_INVALID",
      "packOptions must be an object",
    );
  const pack = (options ?? {}) as Record<string, unknown>;
  function rules(value: unknown): Rule[] {
    if (value === undefined) return [];
    if (!Array.isArray(value))
      throw new CliError(
        "WX_PROJECT_CONFIG_INVALID",
        "packOptions rules must be arrays",
      );
    return value.map((rule) => {
      if (
        !rule ||
        typeof rule !== "object" ||
        typeof rule.value !== "string" ||
        !["file", "folder", "suffix", "prefix", "regexp", "glob"].includes(
          rule.type,
        )
      )
        throw new CliError(
          "WX_PROJECT_CONFIG_INVALID",
          "invalid packOptions rule",
        );
      if (rule.type === "regexp")
        try {
          new RegExp(rule.value);
        } catch {
          throw new CliError(
            "WX_PROJECT_CONFIG_INVALID",
            "invalid packOptions regular expression",
          );
        }
      return { type: rule.type, value: rule.value };
    });
  }
  const include = rules(pack.include),
    ignore = rules(pack.ignore);
  const matches = (file: string, rule: Rule): boolean => {
    const value = rule.value
      .replace(/\\/g, "/")
      .replace(/^\//, "")
      .replace(/\/$/, "");
    switch (rule.type) {
      case "file":
        return file === value;
      case "folder":
        return file.startsWith(value + "/");
      case "suffix":
        return file.endsWith(value);
      case "prefix":
        return file.startsWith(value);
      case "regexp":
        return new RegExp(rule.value).test(file);
      default:
        return minimatch(file, rule.value, { dot: true });
    }
  };
  return (file) =>
    !ignores.some((pattern) => minimatch(file, pattern, { dot: true })) &&
    (include.some((rule) => matches(file, rule)) ||
      !ignore.some((rule) => matches(file, rule)));
}
