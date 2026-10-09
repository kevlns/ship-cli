# ship-cli Agent 指导

用途：校验已构建游戏，执行 SteamPipe 上传、微信小游戏扫码预览与开发版上传。首次调用先读本规范并运行 ship-cli doctor --json；检查 ok 和所有 fail 项。doctor 离线报告退出 0 不代表在线账号可用。

## 顺序

1. 选择正确工程，使用 --project <dir>；路径基准为配置所在目录。先 config validate；初次 config init，填写真实 AppID / 产物路径，只保留使用的平台。
2. Steam：steam vdf --preview 检查配置，steam preview 生成本地清单，steam test --write-appid 检查文件；授权上传后 steam push。显式 --set-live 才设置测试分支，default 自动发布拒绝执行。
3. 微信：wx validate 校验结构和源码预算；wx preview 返回实际二维码，展示给用户；授权上传后 wx push --version <text> 创建开发版。体验版、提审、发布在后台处理。

## 契约

- Steam 需要 steamcmd、构建账号及 App / Depot 权限。仅读取 SHIP_STEAM_*；免密需有效缓存。显式工具路径失效时失败，不切换其他安装。
- 微信工程安装 miniprogram-ci@2.1.31，支持 >=2.1.31 <3。私钥通过 SHIP_WX_PRIVATE_KEY 或 privateKeyPath 指定，必须在产物之外。
- 只支持 schema 的明确字段，拒绝 ciArgs 等未知配置。setting 默认 useProjectConfig=true，robot 为数字 1–30。
- 微信大小为 filtered-source-estimate，不能称为实际编译包大小。上传预算为主包 4 MiB、独立分包 4 MiB、总包 30 MiB；preview 扩展选项不改变上传限制。
- Steam preview 不上传；微信 preview 调用平台服务生成二维码。二维码默认在 build/ship-preview 下，返回绝对路径，不覆盖已有文件。
- 无完整完成记录必须失败；不能用普通 Success 或退出 0 推断上传成功。日志、进度和结果脱敏，目录穿越、产物链接、Steam 缓存交叠拒绝处理。
- 不覆盖已有配置；config init --force 仅在用户授权覆盖时使用。不执行引擎构建、账号注册或正式发布。

## 配套

同一 npm prefix 安装后通过 v-cli ship 执行；先 v-cli agent docs ship，agent describe ship --json 获取清单。随包 v-cli skill 提供发现入口，通过 v-cli agent init 同步。

维护运行 npm run check 与 npm run test:package。官方依据见随包 docs/research/steam.md、docs/research/wechat-minigame.md。npm 发布或真实平台上传须在相应用户任务授权内执行。
