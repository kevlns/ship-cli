# 微信小游戏官方契约

核验日期：2026-10-09。官方页面直接获取成功，同时核对微信 SDK README 和 npm registry。

## 官方依据

- [代码包](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/code-package.html)
- [使用分包](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html)
- [独立分包](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/independent-sub-packages.html)
- [Worker](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/workers)
- [game.json](https://developers.weixin.qq.com/minigame/dev/reference/configuration/app.html)
- [project.config.json](https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html)
- [官方 miniprogram-ci README](https://github.com/wechat-miniprogram/miniprogram-ci-dist/blob/master/README.md)

## 结构与体积

上传默认主包 4 MiB、每个独立分包 4 MiB、总包 30 MiB；普通分包没有单独大小上限。开放数据域计入主包。目录分包根目录需要 game.js，单 JS 文件也可以成为分包。

官方示例 /moduleA/ 是小游戏内路径，工具规范为 moduleA，不当作操作系统绝对路径；拒绝系统盘符、网络路径、目录穿越、根目录交叠。Worker 支持字符串目录以及 {path, isSubpackage:true}；分包能力从基础库 2.27.3 起提供，不属于 independent 分包。

离线统计支持 packOptions 的 file / folder / suffix / prefix / regexp / glob，include 优先于 ignore；SDK Project ignores 独立生效，默认 node_modules/**/*。统计标记 filtered-source-estimate，源码编译压缩后大小会变化。wx validate 是保守离线预算门禁，不代表平台实际编译包大小；最终上传结果由 SDK 和服务器决定。

## SDK 契约

使用 new ci.Project({appid,type:'miniGame',projectPath,privateKeyPath,ignores})，以及 ci.upload / ci.preview 的 Node API。robot 为 1–30 的数字；setting 默认 useProjectConfig=true。配置使用明确布尔字段，不存在 ciArgs 透传。preview 使用 qrcodeFormat=image 与实际 qrcodeOutputDest。

bigPackageSizeSupport 只用于 preview，不改变上传限制，也不承诺小游戏具有固定 8 MiB 预览额度。registry 当前可安装 2.1.31，官方 README 版本列表已到 2.1.48，两者不能混用；工具支持 >=2.1.31 <3。

SDK 必须返回有效完成记录；退出 0 不等于完成。subPackageInfo 可选，原样保留在 JSON 结果中。preview 还必须实际生成 PNG 二维码。私钥须为可解析 PEM，放在上传目录之外；二维码也在产物之外，默认 build/ship-preview/<随机标识>/qr.png，拒绝覆盖已有文件。执行默认超时 15 分钟，可通过 timeoutMs 配置。

upload 创建开发版本；体验版、体验者、提审和发布在微信后台处理。preview 调用微信服务生成扫码入口，不创建开发版本，也不是离线预演。
