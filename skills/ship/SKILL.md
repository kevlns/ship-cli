---
name: ship
description: "校验已构建的游戏产物，执行 Steam 上传、微信小游戏预览和开发版上传。"
---

# 游戏分发

从已有游戏产物开始。Steam 用 `steam vdf` 准备描述、`steam preview` 核对输入、`steam push` 上传。微信小游戏用 `wx validate` 检查工程，`wx preview` 生成试玩码，发布开发版用 `wx push`。首次配置使用 `config init`；排查本机工具或凭据用 `doctor`。

在 Vant 会话的 shell 中，示例里的 `v-cli` 代表插件入口：PowerShell 写作 `node "$env:DSH_VANT_CLI"`，sh 写作 `node "$DSH_VANT_CLI"`。 后接 `ship` 和对应参数。完整参数与交付条件见[操作与边界](references/project.md)。
