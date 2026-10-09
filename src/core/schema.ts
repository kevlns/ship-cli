import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv, { type AnySchema, type ValidateFunction } from "ajv";
import { CliError } from "./errors.ts";

export interface SchemaIssue {
  instancePath: string;
  message: string;
}

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Locate <pkg>/schemas both when running from dist/ (bundled single file) and
 * from src/ during development/tests.
 */
function schemasDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "..", "schemas"), path.resolve(here, "..", "..", "schemas")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

const compiled = new Map<string, ValidateFunction>();

function loadSchemaFile(schemaFile: string): AnySchema {
  const file = path.join(schemasDir(), schemaFile);
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw) as AnySchema;
}

export function validateAgainstSchema(data: unknown, schemaFile: string): SchemaIssue[] {
  let validate: ValidateFunction | undefined = compiled.get(schemaFile);
  if (validate === undefined) {
    validate = ajv.compile(loadSchemaFile(schemaFile));
    compiled.set(schemaFile, validate);
  }
  const ok = validate(data);
  if (ok) return [];
  const issues: SchemaIssue[] = [];
  for (const err of validate.errors ?? []) {
    issues.push({ instancePath: err.instancePath || "/", message: err.message ?? "invalid" });
  }
  return issues;
}

export function assertSchema(documentName: string, data: unknown, schemaFile: string): void {
  const issues = validateAgainstSchema(data, schemaFile);
  if (issues.length > 0) {
    throw new CliError("CFG_SCHEMA_INVALID", `${documentName} failed schema validation`, {
      details: issues.map((issue) => `${issue.instancePath}: ${issue.message}`)
    });
  }
}
