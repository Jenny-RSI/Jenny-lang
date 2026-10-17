# Jenny VS Code / Antigravity 插件与 LSP 服务端验收测试报告 (`vscode-jenny v0.2`)

> **测试日期**：2026-10-17  
> **关联计划**：[`docs/plan/vscode_jenny_extension_plan.md`](../plan/vscode_jenny_extension_plan.md)  
> **关联日志**：[`docs/log/2026-10-17_vscode_jenny_extension_log.md`](../log/2026-10-17_vscode_jenny_extension_log.md)

---

## 1. 功能验收矩阵

| 验收项 | 目标组件 | 测试方法 | 实测结果 | 状态 |
| :--- | :--- | :--- | :--- | :---: |
| **T1: `.jni` Markdown 识别与预览** | [`.vscode/settings.json`](../../.vscode/settings.json) + [`package.json`](../../tools/vscode-jenny/package.json) | 验证 `"*.jni": "markdown"` 文件关联及 `markdown.previewStyles` 注入 | `.jni` 自动启用 Markdown 语法树、Outline 大纲与侧边栏实时预览（带 `JENNY v2.0 FORMAL CONTRACT` 专属样式徽章） | ✅ PASS |
| **T2: ```` ```jenny ```` 围栏块与 `.jn` 语法高亮** | [`jenny.tmLanguage.json`](../../tools/vscode-jenny/syntaxes/jenny.tmLanguage.json) + [`jenny-markdown.tmLanguage.json`](../../tools/vscode-jenny/syntaxes/jenny-markdown.tmLanguage.json) | 检查 `source.jenny` 与 `L:text.html.markdown` 注入作用域规则 | 契约关键字（`requires`/`ensures`/`invariant`/`old`/`result`）、注解（`@spin`/`@example`）、三态修饰符（`mut`/`own`/`self`）及禁用语法警示（`&self`/`let`）均精准着色 | ✅ PASS |
| **T3: 单文件毫秒级静态诊断 (`--check-file`)** | [`compiler/jenny-flow/jenny_flow.py`](../../compiler/jenny-flow/jenny_flow.py) | 执行 `python compiler/jenny-flow/jenny_flow.py --check-file benchmarks/seed_10/B01_ring_buffer/ring_buffer.jni` | 响应耗时 `< 15ms`，正确提取 `10` 个蓝图符号（1 `struct`、1 `enum`、6 `fn`、2 `@example`）且 `ok: true` | ✅ PASS |
| **T4: 标准 JSON-RPC 2.0 LSP 协议端到端交互** | [`tools/vscode-jenny/server/jenny_lsp.py`](../../tools/vscode-jenny/server/jenny_lsp.py) | 通过 `stdio` 发送 `initialize`、`didOpen`、`didChange`（注入 `&self` 与 `let`）、`documentSymbol`、`hover`、`shutdown` | 准确推送 `E0101_FORBIDDEN_REF_SYNTAX` 与 `E0102_FORBIDDEN_LET_BINDING` 诊断，返回 10 个文档符号，并在 `requires` 处返回完整 Markdown Hover 卡片 | ✅ PASS |
| **T5: CodeLens 与编辑器标题栏快捷命令** | [`tools/vscode-jenny/extension.js`](../../tools/vscode-jenny/extension.js) | 验证 `jenny.runExamples`、`jenny.generateSkeleton`、`jenny.previewBlueprint`、`jenny.checkFile` 四个命令挂载 | `.jni` 的 ```` ```jenny ```` 块与 `@example` 上方显示一键运行与生成骨架按钮 | ✅ PASS |
| **T6: 本机多 IDE 扩展目录安装** | 本机扩展目录 | 检查 `~/.vscode/extensions`、`~/.antigravity-ide/extensions`、`~/.antigravity/extensions` | 三个目录均已部署 `jenny-lang.vscode-jenny-0.2.0` | ✅ PASS |

---

## 2. LSP 服务端端到端实测输出摘要

```text
LSP E2E Verification PASSED: {
  'codes_caught': ['E0101_FORBIDDEN_REF_SYNTAX', 'E0102_FORBIDDEN_LET_BINDING'],
  'symbols_count': 10,
  'hover_matched': True
}
```

---

## 3. 用户使用指南（快捷键与交互入口）

1. **立即激活插件**：在 VS Code / Antigravity 中按 `Ctrl+Shift+P`，输入并执行 **`Developer: Reload Window`**（重新加载窗口）。
2. **预览 `.jni` 文学化蓝图**：打开任意 `.jni` 文件（如 `benchmarks/seed_10/B01_ring_buffer/ring_buffer.jni`），点击编辑器右上角的 **预览图标 (`Preview .jni Literate Blueprint`)** 或代码上方 CodeLens 的 **`👁️ Preview .jni Blueprint`**（也可按快捷键 `Ctrl+K V`）。
3. **一键运行 `@example` 沙箱测试**：点击 `.jni` 或 `.jn` 文件中的 **`▶ Run @example Contract Tests`** CodeLens 按钮，右下角将直接弹出编译与契约测试通过通知。
4. **一键生成 `.jn` 骨架**：在 `.jni` 文件中点击 **`🦴 Generate .jn Skeleton`**，右侧分栏将自动打开带契约注释的 `.jn` 实现骨架。
