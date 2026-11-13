---
name: ship
description: "校验已构建的游戏产物，执行 Steam 上传、微信小游戏预览和开发版上传。"
---

# 游戏分发

按用户目标调用工具，执行前读取 [操作与边界](references/project.md)，以实时 describe 返回的参数契约为准。失败时报告实际状态，不通过重复提交或修改身份掩盖未知结果。
