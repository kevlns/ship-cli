export { VERSION, PACKAGE_NAME } from "./version.ts";
export { CliError } from "./core/errors.ts";
export { SUGGESTIONS, suggest, type FixSuggestion } from "./core/suggest.ts";
export {
  CONFIG_FILE_NAME,
  DEFAULT_WX_LIMITS,
  findConfigFile,
  loadConfig,
  type ShipConfig,
  type SteamConfig,
  type WechatConfig
} from "./core/config.ts";
export { validateAgainstSchema } from "./core/schema.ts";
export { runProcess, lookupOnPath, type ProcessRunner, type ProcessResult } from "./core/exec.ts";
export {
  renderAppBuildVdf,
  renderDepotBuildVdf,
  appBuildVdfName,
  depotBuildVdfName,
  escapeVdfString,
  quoteVdf,
  type AppBuildVdfInput,
  type DepotBuildVdfInput
} from "./steam/vdf.ts";
export { generateSteamTotp } from "./steam/totp.ts";
export { analyzeSteamcmdOutput, type SteamcmdOutcome } from "./steam/logparse.ts";
export {
  buildLoginArgs,
  describeCredentialMode,
  findSteamcmd,
  resolveSteamCredentials,
  seedConfigVdf,
  steamBuildsUrl,
  type SteamCredentials
} from "./steam/steamcmd.ts";
export { parseGameJson, type GameJson, type SubpackageEntry } from "./wx/gamejson.ts";
export { formatBytes, validateWechatProject, type WxValidationReport } from "./wx/validate.ts";
export { buildDriverScript, resolveMiniprogramCi, resolvePrivateKey, runWxCi } from "./wx/cicli.ts";
export { buildProgram, main, cliErrorExit } from "./cli.ts";
