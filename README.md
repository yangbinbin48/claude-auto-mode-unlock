# Claude Code Unlocker

解除 Claude Code CLI 的功能限制，使**所有 API 代理和模型**都能使用全部功能。

支持 OpenRouter、bigmodel.cn、AWS Bedrock、自建 Anthropic 兼容 API 等第三方代理。

本项目包含两个独立的补丁工具：

- **`claude-auto-mode-patcher.mjs`** — 解锁 auto 模式，无需逐条确认权限，自动执行。
- **`claude-buddy-patcher.mjs`** — 解锁 buddy 互动功能，小伙伴用你配置的 haiku 模型发表评论。

## 环境要求

- **Claude Code CLI v2.1.96**
- Node.js 18+
- macOS 或 Linux

## 快速开始

```bash
git clone https://github.com/zzturn/claude-auto-mode-unlock.git
cd claude-auto-mode-unlock

node claude-auto-mode-patcher.mjs    # auto mode 补丁
node claude-buddy-patcher.mjs        # buddy 补丁
```

---

## Auto Mode 补丁

解锁 auto 模式，自动执行无需逐条确认。

### 用法

```bash
node claude-auto-mode-patcher.mjs           # 应用
node claude-auto-mode-patcher.mjs --check   # 检查状态
node claude-auto-mode-patcher.mjs --restore # 恢复
CLAUDE_BIN=/path/to/claude node claude-auto-mode-patcher.mjs  # 指定路径
```

### 使用

```bash
claude --permission-mode auto    # 启动时启用
# 或在会话中按 Shift+Tab 切换
```

### 原理

Claude Code 使用 [Bun](https://bun.sh/) 编译为独立二进制文件，JavaScript 源码以明文嵌入。本脚本通过**等长字节替换**修改 6 个权限检查函数：

| # | 目标 | 效果 |
|---|------|------|
| 1 | `modelSupportsAutoMode` — provider 检查 | 绕过 firstParty/anthropicAws 限制 |
| 2 | `modelSupportsAutoMode` — model 正则 | 绕过 claude-opus/sonnet-4-6 模型名限制 |
| 3 | `isAutoModeGateEnabled` | 始终返回 `true` |
| 4 | `isAutoModeCircuitBroken` | 始终返回 `false` |
| 5 | `verifyAutoModeGateAccess` | 强制走 happy path |
| 6 | `carouselAvailable` | 始终为 `true`（Shift+Tab 可切换） |

---

## Buddy 补丁

解锁 buddy companion 互动功能。小伙伴会用你配置的 haiku 模型（`ANTHROPIC_DEFAULT_HAIKU_MODEL`）发表评论。

### 用法

```bash
node claude-buddy-patcher.mjs           # 应用
node claude-buddy-patcher.mjs --check   # 检查状态
node claude-buddy-patcher.mjs --analyze # 诊断分析（不改文件）
node claude-buddy-patcher.mjs --restore # 恢复
CLAUDE_BIN=/path/to/claude node claude-buddy-patcher.mjs  # 指定路径
```

### 使用

在 Claude Code 中输入 `/buddy` 孵化小伙伴：

| 命令 | 作用 |
|------|------|
| `/buddy` | 孵化一个小伙伴 |
| `/buddy pet` | 摸摸它，触发反应 |
| `/buddy off` | 关闭小伙伴评论 |
| `/buddy on` | 重新开启 |

### 原理

基于源码分析的 5 阶段 patching：

1. **LOCATE** — 通过函数签名锚点定位 `Fa_`（buddyReact）函数
2. **VALIDATE** — 用 3 个源码派生的结构验证器确认目标正确
3. **BOUNDARY** — 花括号平衡扫描确定函数边界（支持正则字面量、模板字面量）
4. **REPLACE** — 动态生成等长本地 LLM 替换（含 JS 语法验证）
5. **VERIFY** — 补丁后完整性验证

原始 `Fa_` 有 4 层门控（auth provider、rate limit、org UUID、OAuth token），最终调用远程 API。补丁替换整个函数体，使用与 `wE7`（companion 生成）相同的 `Y0`/`ZP()` 本地 LLM 调用模式，直接用配置的 haiku 模型生成 reaction。

---

## 项目文件

| 文件 | 说明 |
|------|------|
| `claude-auto-mode-patcher.mjs` | Auto mode 补丁脚本 |
| `claude-buddy-patcher.mjs` | Buddy 补丁脚本 |
| `buddy-source-extracted.js` | 从二进制提取并标注的 buddy 系统源码 |
| `GUIDE.md` | 详细使用说明 |
| `METHODOLOGY.md` | 源码驱动的二进制 Patch 方法论文档 |

## 恢复原版

```bash
node claude-buddy-patcher.mjs --restore
node claude-auto-mode-patcher.mjs --restore
```

## 安全性

- 补丁前自动创建备份文件（`.auto-mode-backup` / `.buddy-backup`）
- 所有替换严格等长，不破坏二进制结构
- macOS 上自动执行 `codesign --force --sign -` 重新签名
- 可通过 `--restore` 完全恢复原始二进制

## 注意事项

- **版本绑定**：补丁基于 v2.1.96，其他版本可能不兼容
- **升级后需重新打补丁**：Claude Code 更新会替换二进制
- **auto 模式安全分类器仍生效**：仅解除入口限制，`classifyYoloAction` 仍会评估安全性

## 常见问题

<details>
<summary>脚本显示 "SKIP" 或 "No patches applied"</summary>

二进制可能已被补丁（运行 `--check` 查看），或版本不是 v2.1.96。
</details>

<details>
<summary>补丁后 claude 命令无法启动</summary>

```bash
node claude-auto-mode-patcher.mjs --restore
# 或
node claude-buddy-patcher.mjs --restore
```
</details>

<details>
<summary>macOS 上 codesign 失败</summary>

```bash
codesign --force --sign - "$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' ~/.local/bin/claude)"
```
</details>

<details>
<summary>Buddy 不说话？</summary>

反应有 30 秒冷却，需要足够对话上下文。叫它名字或 `/buddy pet` 可触发。
</details>

## License

MIT
