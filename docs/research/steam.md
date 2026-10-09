# Steam 官方契约

核验日期：2026-10-09。依据 Valve [Uploading to Steam](https://partner.steamgames.com/doc/sdk/uploading)、[Steamworks API](https://partner.steamgames.com/doc/sdk/api)、[Depots](https://partner.steamgames.com/doc/store/application/depots)。

- SteamPipe 通过 steamcmd 的 +login / +run_app_build / +quit 构建上传已生成的产物。ship-cli 不执行引擎构建。
- AppBuild VDF 指定 AppID、Desc、ContentRoot、BuildOutput、Preview、SetLive、Depots；DepotBuild VDF 指定 DepotID、ContentRoot、FileMapping、FileExclusion。
- Preview=1 产生本地日志和清单，不上传。SetLive 仅用于测试分支，default 分支必须在 Steamworks 后台处理。
- BuildOutput 保存缓存和日志，必须与上传产物分离；工具校验真实路径，包括 Windows junction，拒绝目录交叠和产物链接。
- Steam API 分发库为 Windows 的 steam_api.dll / steam_api64.dll、Linux 的 libsteam_api.so、macOS 的 libsteam_api.dylib。steam test 检查文件与 AppID，不启动游戏，也不能证明 SDK 初始化成功。
- 本地绕过 Steam 客户端启动时通过 steam_appid.txt 提供 AppID；正常从 Steam 启动的发行包不依赖该文件。

Valve 没有承诺稳定的机器可读日志协议。工具采取保守判定：非零退出、错误日志、登录 Guard 提示均失败；成功记录须包含当前 AppID 的 Successfully finished ... build，真实上传还须包含 BuildID。无法确定时返回 STM_BUILD_UNKNOWN_OUTCOME。这条日志解析规则仍需真实账号日志验证。

工具仅读取 SHIP_STEAM_*。免密登录需要有效的 steamcmd 缓存；SHIP_STEAM_CONFIG_VDF 提供 base64 缓存，拒绝覆盖不同的已有文件。缓存存在不代表账号或权限有效。进度和日志脱敏包括跨输出块拆分的密码及运行时生成的 Guard 码；执行超时为一小时。
