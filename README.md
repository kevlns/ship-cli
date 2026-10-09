# ship-cli

校验已经构建好的游戏，生成 SteamPipe 配置，执行 Steam 上传、微信小游戏预览与开发版上传。引擎构建、账号配置和正式发布由外部流程完成。

## 安装与发现

Node.js 20 及以上。npm 安装：`npm install -g @kevlns/ship-cli`。源码打包安装：

```bash
npm ci
npm run check
npm pack
npm install -g ./kevlns-ship-cli-0.1.0.tgz
ship-cli --version
```

v-cli 已注册 ship 为官方可选 peer 插件。将两者安装在同一 npm prefix 后自动发现：

```bash
v-cli plugin list --json
v-cli agent docs ship
v-cli agent describe ship --json
v-cli ship --help
```

## 使用流程

在游戏仓库执行 config init，编辑真实 AppID、产物路径，只保留使用的平台配置。路径以 ship.config.json 所在目录为基准；产物位于工程内，私钥和外部工具可用绝对路径。默认向上查找配置，--project <dir> 显式选择工程。

```bash
ship-cli config validate --json
ship-cli doctor --json
```

doctor 离线输出逐项状态，退出 0 表示报告生成；查看 ok 和 fail 项确认就绪，不能据此判断在线账号权限。模板含两个平台，不使用的平台应删除。

Steam：

```bash
ship-cli steam vdf --preview
ship-cli steam preview --desc "local rehearsal"
ship-cli steam test --write-appid
ship-cli steam push --desc "0.3.7 nightly" --set-live beta
ship-cli steam open builds
```

vdf 只写配置；preview 生成本地清单而不上传；test 检查 AppID、API 库与已配置可执行文件，不能替代启动游戏；push 上传，显式 --set-live 才设置测试分支。default 自动发布拒绝执行。

微信：在游戏工程安装 npm i -D miniprogram-ci@2.1.31。

```bash
ship-cli wx validate --json
ship-cli wx preview --robot 1 --json
ship-cli wx push --version 1.0.0 --desc "fix: login loop" --robot 1 --json
ship-cli wx open mp
```

validate 校验结构、配置一致性及过滤后的源码预算，默认主包 / 独立分包 / 总包 4 / 4 / 30 MiB。源码统计不是编译包大小，SDK 返回的编译信息保留在结果中。preview 调用微信服务生成二维码，JSON 返回绝对路径；push 在离线门禁通过后创建开发版本。体验版、提审、发布在后台人工完成。

## 配置

schema 随包提供于 schemas/ship-config.schema.json，未知字段拒绝加载。

wechat 支持 appid、projectPath、robot、privateKeyPath、ignores、setting、bigPackageSizeSupport、timeoutMs。setting 默认 useProjectConfig=true，支持 es6、es7、minify、minifyJS、codeProtect、autoPrefixWXSS；bigPackageSizeSupport 只用于 preview。robot 为整数 1–30，timeoutMs 范围 1000–3600000。

| 环境变量 | 用途 |
| --- | --- |
| SHIP_STEAMCMD | steamcmd 路径，优先于配置 |
| SHIP_STEAM_USERNAME | Steam 构建账号 |
| SHIP_STEAM_PASSWORD | 密码，缓存免密时可省略 |
| SHIP_STEAM_TOTP | 本次 Guard 码 |
| SHIP_STEAM_TOTP_SECRET | base64 共享密钥，用于生成 Guard 码 |
| SHIP_STEAM_CONFIG_VDF | base64 免密缓存配置 |
| SHIP_WX_PRIVATE_KEY | 微信上传私钥路径，优先于配置 |

私钥与二维码必须位于微信产物之外。二维码默认 build/ship-preview/<随机标识>/qr.png，显式路径必须为新文件。Steam 缓存与产物不可交叠，产物链接拒绝处理；凭据不写入配置，日志和进度脱敏。

执行命令的 --json 成功带 ok=true，失败带 ok=false 与 error.code / message / details / fix / docs；doctor 的 ok 表示体检状态。帮助、工具版本为文本。退出码：0 成功或报告已生成，1 参数 / 配置 / 内容校验拒绝，2 前置条件缺失，3 Steam 执行失败，4 微信 SDK 失败。未知完成结果按失败处理。

## 维护

npm run check 覆盖构建、类型、测试、lint、打包护栏；npm run test:package 对真实 tgz 隔离安装验证。prepack 自动构建，安装包携带当前代码、schema、插件清单、Agent 规范及官方调研文档。CI 配置 Windows / Linux / macOS 与 Node 20 / 22。

依据与实现边界见 [Steam](docs/research/steam.md)、[微信小游戏](docs/research/wechat-minigame.md)。
