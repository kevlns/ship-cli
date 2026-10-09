import path from "node:path";
import { CONFIG_FILE_NAME, CONFIG_TEMPLATE, loadConfig, writeConfigTemplate } from "../core/config.ts";
import { log } from "../core/logger.ts";

export async function runConfigInit(startDir: string, force: boolean, json: boolean): Promise<void> {
  const target = path.join(path.resolve(startDir), CONFIG_FILE_NAME);
  await writeConfigTemplate(target, force);
  if (json) {
    log.result({ written: target, force });
  } else {
    log.info(`wrote ${target}`);
    log.info("edit appId/appid/paths, then run: ship-cli config validate");
  }
}

export async function runConfigValidate(startDir: string, json: boolean): Promise<void> {
  const config = await loadConfig(startDir);
  if (json) {
    log.result({
      ok: true,
      projectRoot: config.projectRoot,
      steam: config.steam === undefined ? null : { appId: config.steam.appId, depots: config.steam.depots.length },
      wechat: config.wechat === undefined ? null : { appid: config.wechat.appid, robot: config.wechat.robot ?? 1 }
    });
  } else {
    log.info(`${path.join(config.projectRoot, CONFIG_FILE_NAME)} OK`);
    if (config.steam !== undefined) {
      log.info(`  steam: appId=${config.steam.appId}, depots=${config.steam.depots.map((d) => d.id).join(",")}`);
    }
    if (config.wechat !== undefined) {
      log.info(`  wechat: appid=${config.wechat.appid}, robot=${config.wechat.robot ?? 1}`);
    }
  }
}

export async function runConfigShow(startDir: string, json: boolean): Promise<void> {
  const config = await loadConfig(startDir);
  const { projectRoot, ...rest } = config;
  if (json) {
    log.result({ projectRoot, ...rest });
  } else {
    log.result(`${JSON.stringify({ projectRoot, ...rest }, null, 2)}`);
  }
}

export function configTemplate(): unknown {
  return CONFIG_TEMPLATE;
}
