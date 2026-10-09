/**
 * Redaction for diagnostics. Secrets must never appear in echoed output, log
 * files or `--json` results. Longer secrets are replaced first.
 */
export function redactSecrets(
  text: string,
  secrets: Array<string | undefined>,
): string {
  let out = text;
  for (const secret of [...new Set(secrets)].sort(
    (a, b) => (b?.length ?? 0) - (a?.length ?? 0),
  )) {
    if (secret !== undefined && secret.length > 0) {
      out = out.split(secret).join("***");
    }
  }
  return out;
}

export function maskSecret(secret: string | undefined): string {
  if (secret === undefined || secret.length === 0) return "(unset)";
  return `***(${secret.length} chars)`;
}
