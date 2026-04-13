# Claude Code 补丁工具集 — 使用说明

解除 Claude Code CLI 的功能限制，让第三方 API 也能使用全部功能。

## 补丁列表

| 补丁 | 脚本 | 功能 |
|------|------|------|
| Auto Mode | `claude-auto-mode-patcher.mjs` | 解锁 auto 模式 |
| Buddy | `claude-buddy-patcher.mjs` | 解锁 buddy 互动（用你配置的 API 聊天） |

---

## 快速开始

```bash
# 1. 进入目录
cd /Users/xin/Downloads/src/claude-auto-mode-unlock

# 2. 应用补丁
node claude-auto-mode-patcher.mjs    # auto mode
node claude-buddy-patcher.mjs        # buddy

# 3. 重启 Claude Code
```

---

## 环境要求

- Node.js 18+
- Claude Code CLI v2.1.96

---

## Auto Mode 补丁

解锁 auto 模式，无需逐条确认权限，自动执行。

```bash
node claude-auto-mode-patcher.mjs           # 应用
node claude-auto-mode-patcher.mjs --check   # 检查状态
node claude-auto-mode-patcher.mjs --restore # 恢复
```

使用：启动时加 `--permission-mode auto`，或会话中按 `Shift+Tab`。

---

## Buddy 补丁（源码分析版）

解锁 buddy 互动功能。小伙伴会用你配置的 haiku 模型（`ANTHROPIC_DEFAULT_HAIKU_MODEL`）发表评论。

基于源码分析的 5 阶段 patching：
1. **LOCATE** — 通过函数签名锚点定位 Fa_ 函数
2. **VALIDATE** — 用 3 个源码派生的结构验证器确认
3. **BOUNDARY** — 花括号平衡扫描确定函数边界
4. **REPLACE** — 动态生成等长 Y0/ZP 本地 LLM 替换
5. **VERIFY** — 补丁后完整性验证

```bash
node claude-buddy-patcher.mjs           # 应用
node claude-buddy-patcher.mjs --check   # 检查状态
node claude-buddy-patcher.mjs --analyze # 诊断分析（不改文件）
node claude-buddy-patcher.mjs --restore # 恢复
```

使用：在 Claude Code 中输入 `/buddy` 孵化小伙伴。

| 命令 | 作用 |
|------|------|
| `/buddy` | 孵化一个小伙伴 |
| `/buddy pet` | 摸摸它，触发反应 |
| `/buddy off` | 关闭小伙伴评论 |
| `/buddy on` | 重新开启 |

---

## 恢复原版

```bash
node claude-buddy-patcher.mjs --restore
node claude-auto-mode-patcher.mjs --restore
```

---

## 常见问题

**补丁后无法启动？** 补丁脚本会自动执行 `codesign` 修复签名。如仍失败，手动执行：
```bash
codesign --force --sign - "$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' ~/.local/bin/claude)"
```

**Buddy 不说话？** 反应有 30 秒冷却，需要足够对话上下文。叫它名字或 `/buddy pet` 可触发。

**更新后补丁失效？** Claude Code 更新会替换二进制，需重新执行补丁。

---

## Buddy Reroll（刷属性）

```bash
bun buddy-reroll.js --species dragon --rarity legendary --shiny
bun buddy-reroll.js --species duck --min-stats 80
```

> 需用 Bun 运行才能匹配实际结果。
