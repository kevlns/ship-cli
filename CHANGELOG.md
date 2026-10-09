# Changelog

## 0.1.0 (2026-10-08)

首个版本：Steam + 微信小游戏 双平台"校验/打包/推送到测试通道"。

- Steam：VDF 生成器（AppBuild/DepotBuild，仅官方文档字段）、steamcmd 发现与凭据三
  模式（密码+TOTP / 仅密码 / config.vdf 免密，含 Steam TOTP 生成与 config.vdf 播种）、
  `preview`（Preview=1 演练）与 `push`（真实上传，可自动 set-live 到非 default 分支）、
  日志判定（ERROR 特征 + BuildID 成功特征，未知按失败）、本地冒烟 `steam test`
  （steam_appid.txt / steam_api dll / run URL）。
- 微信小游戏：离线校验 `wx validate`（结构、subpackages/subPackages 双拼写、嵌套、
  开放数据域互斥、主包 4M / 独立分包 4M / 总包 30M，阈值可覆盖）、`wx preview`
  二维码、`wx push` 开发版上传（内部先跑同样校验；miniprogram-ci 经 node -e 驱动其
  Node API，非 CLI flag 猜测）。
- 基础设施：ship.config.json（JSON Schema 校验 + 跨字段校验）、doctor 离线体检、
  双通道输出、`--json`、稳定错误码/退出码、密钥全链路脱敏、原子写入、pack-guard、
  安装冒烟、v-cli.plugin.json（14 命令 agent 元数据 + 漂移测试）。
- 平台规则调研文档（含官方来源）：`docs/research/steam.md`、`docs/research/wechat-minigame.md`。
