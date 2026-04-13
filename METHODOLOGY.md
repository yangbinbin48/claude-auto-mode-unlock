# 源码驱动的二进制 Patch 方法论

基于 Claude Code CLI（Bun SEA）逆向分析与补丁开发的实战经验总结。

---

## 目录

1. [全景视图](#1-全景视图)
2. [阶段一：侦察 — 理解目标系统](#2-阶段一侦察--理解目标系统)
3. [阶段二：提取 — 从二进制中获取源码](#3-阶段二提取--从二进制中获取源码)
4. [阶段三：分析 — 建立源码到二进制的映射](#4-阶段三分析--建立源码到二进制的映射)
5. [阶段四：设计 — 确定补丁策略](#5-阶段四设计--确定补丁策略)
6. [阶段五：实施 — 编写补丁工具](#6-阶段五实施--编写补丁工具)
7. [阶段六：验证 — 确认补丁正确性](#7-阶段六验证--确认补丁正确性)
8. [工具箱](#8-工具箱)
9. [模式速查表](#9-模式速查表)
10. [实战案例回顾](#10-实战案例回顾)

---

## 1. 全景视图

```
┌─────────────────────────────────────────────────────────────────┐
│                     源码驱动的二进制 Patch 流程                     │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │  侦察     │──▶│  提取     │──▶│  分析     │──▶│  设计     │   │
│  │ Recon    │   │ Extract  │   │ Analyze  │   │ Design   │   │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘    │
│       │                                            │            │
│       │              ┌──────────┐                  │            │
│       │              │  验证     │◀────────────────│            │
│       │              │ Verify   │                  │            │
│       │              └──────────┘                  │            │
│       │                    ▲                       ▼            │
│       │                    │              ┌──────────┐          │
│       │                    └──────────────│  实施     │          │
│       │                                   │ Implement│          │
│       │                                   └──────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

**核心原则**：永远不要对不理解的东西做 patch。先分析源码，再定位二进制，最后修改。

---

## 2. 阶段一：侦察 — 理解目标系统

### 2.1 确定二进制类型

```bash
file /path/to/binary
```

常见类型：

| 类型 | 特征 | 源码可提取性 |
|------|------|------------|
| Mach-O (macOS) | Bun/Node SEA 嵌入 JS 明文 | ★★★★★ 高 |
| ELF (Linux) | 同上，结构略有不同 | ★★★★★ 高 |
| WASM 二进制 | 编译后的字节码 | ★★☆☆☆ 低 |
| Go 二进制 | 编译成本地代码 | ★☆☆☆☆ 极低 |
| Rust 二进制 | 编译成本地代码 | ★☆☆☆☆ 极低 |

**关键判断**：如果二进制是用 **Bun** 或 **Node.js SEA** 编译的，JavaScript 源码以 **UTF-8 明文**嵌入，可以直接提取。

### 2.2 确认源码嵌入方式

```bash
# 检查二进制中是否有 JS 源码
strings /path/to/binary | grep -c 'function '
# 如果输出几千以上 → JS 源码已嵌入

# 检查是否有 SEA (Single Executable Application) 标记
python3 -c "
data = open('/path/to/binary', 'rb').read()
for marker in [b'node-sea', b'Bun', b'sea-flag']:
    idx = data.find(marker)
    if idx != -1:
        print(f'Found {marker!r} at 0x{idx:x}')
"
```

### 2.3 检查是否有原始 TypeScript 源码可用

有时开发者会有部分泄漏的源码：

```bash
# 检查项目中是否有源码文件
find /path/to/project -name "*.ts" -o -name "*.tsx" -o -name "*.js" | head -20

# 检查 sourcemap
strings /path/to/binary | grep -c 'sourceMappingURL'
```

**实战发现**：Claude Code 的 buddy 系统源码散布在两个位置：
- `/src/buddy/` — 类型定义、生成逻辑、UI 组件（TypeScript）
- 二进制内部 — reaction API 调用、观察者逻辑（编译后 JS，无对应源文件）

这种"部分源码可用"的情况很常见——不要假设你拥有完整源码。

---

## 3. 阶段二：提取 — 从二进制中获取源码

### 3.1 strings 命令快速提取

```bash
# 基本提取 — 找到所有可读字符串
strings -n 10 /path/to/binary > extracted-strings.txt

# 搜索特定函数
strings /path/to/binary | grep 'buddy'
strings /path/to/binary | grep 'companion'
strings /path/to/binary | grep 'react'
```

### 3.2 精确定位函数代码

```python
# find_function.py — 在二进制中定位函数并提取
import sys

data = open(sys.argv[1], 'rb').read()
search = sys.argv[2].encode('utf8')

idx = 0
while True:
    idx = data.find(search, idx)
    if idx == -1:
        break
    # 提取前后各 500 字节的上下文
    start = max(0, idx - 100)
    end = min(len(data), idx + len(search) + 500)
    context = data[start:end].decode('utf8', errors='replace')
    print(f'--- Found at 0x{idx:x} ---')
    print(context)
    print()
    idx += 1
```

用法：
```bash
python3 find_function.py /path/to/binary "async function Fa_"
```

### 3.3 提取完整模块

在 Bun/Node SEA 中，模块以 `G(()=>{...})` 模式组织。找到函数后，可以顺着找到整个模块：

```bash
# 找到函数签名
# 向后扫描，找到模块边界（下一个 var ... = G(()=>{）
python3 -c "
data = open('/path/to/binary', 'rb').read()
sig = b'async function Fa_'
idx = data.find(sig)
# 从函数位置向后找 5KB，提取整个模块
chunk = data[idx:idx+5000].decode('utf8', errors='replace')
print(chunk)
"
```

### 3.4 关键经验：双重副本

**发现**：Bun SEA 二进制中 JS 源码通常出现 **两次**：
1. 主体源码区域（前半部分）
2. SEA payload 区域（后半部分）

```
二进制布局:
┌─────────────────────┐
│ Mach-O Header        │
│ Code Segment         │
│ ─────────────────── │
│ JS Source (Copy 1)   │ ◀── patch 目标 1
│ ... 190MB ...        │
│ JS Source (Copy 2)   │ ◀── patch 目标 2
│ ─────────────────── │
│ SEA Metadata         │
└─────────────────────┘
```

**结论**：所有 patch 必须应用于 **两个** 副本，否则只有部分功能生效。

---

## 4. 阶段三：分析 — 建立源码到二进制的映射

这是最关键的阶段。目标是建立 **"混淆名 → 真实含义"** 的完整映射。

### 4.1 识别字符串常量锚点

字符串常量是最可靠的锚点——它们不会被混淆：

```bash
# 在二进制中搜索 API 路径
strings /path/to/binary | grep '/api/'
# 输出: /api/organizations/{org}/claude_code/buddy_react

# 搜索配置键名
strings /path/to/binary | grep 'companion'
# 输出: companion, companionMuted, companionReaction

# 搜索日志前缀
strings /path/to/binary | grep '\[buddy\]'
# 输出: [buddy] api failed:, [buddy] soul response:
```

### 4.2 构建函数映射表

根据字符串常量和代码结构，逐步建立映射：

```
┌──────────────┬────────────────────┬─────────────────────────────┐
│ 混淆名       │ 真实名              │ 识别依据                      │
├──────────────┼────────────────────┼─────────────────────────────┤
│ Fa_          │ buddyReact()       │ 调用 buddy_react API 端点     │
│ KE7          │ fireCompanionObs.. │ 每轮后调用 Fa_ 的入口         │
│ OE7          │ hatchReaction      │ 孵化时调用 Fa_               │
│ $E7          │ petReaction        │ pet 时调用 Fa_               │
│ UP5          │ buildTranscript    │ 构建 user/assistant 摘要      │
│ tS7          │ extractToolOutput  │ 提取 tool_result 内容        │
│ oP5          │ detectSpecialRe..  │ 检测 test-fail/error/large.. │
│ aP5          │ isAddressedByName  │ 正则匹配 companion 名字      │
│ wE7          │ generateCompanion  │ 调用 Y0(querySource:"buddy.. │
│ Y0           │ callLocalLLM       │ querySource 参数模式          │
│ ZP()         │ getHaikuModel()    │ 返回配置的模型名              │
│ Qa_          │ isBuddyAvailable   │ 硬编码 return !0              │
│ lq()         │ isAuthProvider()   │ 返回 "firstParty" 等字符串    │
│ T_()         │ getGlobalConfig()  │ 返回 .companion, .companion..│
└──────────────┴────────────────────┴─────────────────────────────┘
```

### 4.3 逆向参数类型

通过函数调用处的参数推导参数类型：

```javascript
// 调用处（从 KE7 中提取）:
Fa_(q, w, z, RIH, K, AbortSignal.timeout(1e4))
//  ↑  ↑  ↑   ↑   ↑          ↑
//  │  │  │   │   │          └─ AbortSignal → 信号参数
//  │  │  │   │   └─────────── 布尔值 → 被叫名字？
//  │  │  │   └─────────────── 数组 → 最近 reactions
//  │  │  └─────────────────── 字符串 → reason
//  │  └────────────────────── 字符串 → 对话摘要
//  └────────────────────────── 对象 → companion

// Fa_ 函数内部使用:
// H.name → companion 有 name 属性
// H.personality → companion 有 personality 属性
// H.species, H.rarity, H.stats → 骨头属性
```

### 4.4 识别"已验证模式"

在源码中找到已经工作的、与你的目标类似的模式：

```javascript
// wE7 (generateCompanion) — 已经在使用 Y0/ZP，且确认工作
async function wE7(H, _, q) {
  let T = await Y0({           // ← 本地 LLM 调用
    querySource: "buddy_companion",
    model: ZP(),               // ← 配置的 haiku 模型
    system: tP5,
    messages: [{ role: "user", content: $ }],
    output_format: { type: "json_schema", schema: ... },
    max_tokens: 512,
    temperature: 1,
    signal: q,
  });
  let z = O1(T.content);       // ← 提取文本
  return ...;
}
```

**这个模式就是你的补丁模板**。如果 `Y0` + `ZP()` + `O1` 在 `wE7` 中工作，那么在 `Fa_` 中也会工作——它们在同一个作用域。

---

## 5. 阶段四：确定补丁策略

### 5.1 三种补丁策略

| 策略 | 适用场景 | 风险 |
|------|---------|------|
| **等长精确替换** | 知道完整的原始代码 | 低 — 不破坏偏移量 |
| **锚点 + 动态替换** | 知道函数签名但内容可能变化 | 中 — 需要边界扫描 |
| **NOP 填充** | 只需跳过一段逻辑 | 低 — 把代码替换为空操作 |

### 5.2 选择最小修改点

**原则**：改最少的代码达到目的。

```
Fa_ 原始逻辑:
  Gate 1: lq() !== "firstParty" → return null   ← 阻止第三方 API
  Gate 2: X3() → return null                     ← 频率限制
  Gate 3: !organizationUuid → return null         ← 需要组织 ID
  Gate 4: !accessToken → return null              ← 需要 OAuth token
  Action: POST /buddy_react API → return reaction

考虑的方案:
  方案 A: 只绕过 Gate 1 → 不够，3rd-party 没有 OAuth token
  方案 B: 绕过 Gate 1+3+4 → 不够，远程 API 不认识 3rd-party
  方案 C: 替换整个函数 → ✅ 彻底解决问题

结论: 必须替换整个函数体，因为远程 API 本身不可用。
```

### 5.3 设计替换函数

替换函数必须满足：
1. **相同签名** — 参数列表不变
2. **相同返回类型** — 返回 `string | null`
3. **相同字节长度** — 这是硬约束
4. **使用已验证模式** — 复用 `Y0`/`ZP()`/`O1`

```javascript
// 替换函数设计
async function Fa_(H, _, q, K, O, $) {
  try {
    // 构建 prompt（利用所有参数增加丰富性）
    var p = "You are " + H.name + ", " + H.rarity + " " + H.species + "..."
    // 使用已验证的 Y0/ZP 模式
    var T = await Y0({querySource: "...", model: ZP(), ...});
    var z = O1(T.content);
    return z ? z.trim() : null;
  } catch (T) {
    // 保持与原始相同的错误处理
    return h("[buddy] api failed: " + T, {level: "debug"}), null;
  }
}
```

### 5.4 字节长度对齐

```
原始函数: 695 bytes
替换函数: 687 bytes
差距:      8 bytes

解决方法: 在语法合法的位置插入空格填充

  '}catch(T){'        →  原始
  '}        catch(T){' →  填充后（8个空格，合法 JS 空白）

  原始位置: function body 的 } 后面
  其他合法填充位置:
    - catch 语句前的 }
    - return 语句后的 ;
    - 对象字面量中的空格
```

---

## 6. 阶段五：编写补丁工具

### 6.1 两种架构对比

#### 架构 A：精确匹配（简单，脆弱）

```javascript
// 把整个函数体作为搜索串
const SEARCH = 'async function Fa_(H,_,q,K,O,$){if(lq()!=="firstParty")...'  // 695 bytes
const REPLACE = 'async function Fa_(H,_,q,K,O,$){try{var p=...'

if (SEARCH.length !== REPLACE.length) throw Error('Length mismatch!')
```

**优点**：简单，100% 确定匹配的是正确的代码
**缺点**：版本更新后，一个字符变化就导致完全失效

#### 架构 B：锚点 + 验证（复杂，健壮）✅ 推荐

```javascript
// Phase 1: 用短锚点定位
const SIGNATURE = 'async function Fa_(H,_,q,K,O,$){'

// Phase 2: 验证上下文
const VALIDATORS = [
  'lq()!=="firstParty"',   // 确认是 auth gate
  'buddy_react',            // 确认是 API 调用
  '$6.post',                // 确认是 HTTP 请求
]

// Phase 3: 动态边界扫描（花括号平衡）
function findFunctionEnd(buf, start) { ... }

// Phase 4: 动态生成长度匹配的替换
function generateReplacement(originalLen) { ... }
```

**优点**：版本更新时仍可能工作（只要函数签名不变）
**缺点**：实现复杂，需要处理模板字面量等边界情况

### 6.2 花括号平衡扫描

JS 代码中的花括号有四种上下文，必须正确处理：

```javascript
function findFunctionEnd(buf, startOffset) {
  let depth = 0
  let i = startOffset

  while (i < buf.length) {
    const byte = buf[i]

    // 上下文 1: 模板字面量 `...${expr}...`
    if (byte === 0x60) {  // backtick
      i++
      while (i < buf.length) {
        if (buf[i] === 0x5C) { i += 2; continue }  // 转义
        if (buf[i] === 0x60) { i++; break }          // 闭合
        if (buf[i] === 0x24 && buf[i+1] === 0x7B) {  // ${
          i += 2
          let exprDepth = 1
          while (i < buf.length && exprDepth > 0) {
            if (buf[i] === 0x7B) exprDepth++
            else if (buf[i] === 0x7D) exprDepth--
            if (exprDepth > 0) i++
          }
          i++
          continue
        }
        i++
      }
      continue
    }

    // 上下文 2: 字符串字面量 "..." 或 '...'
    if (byte === 0x22 || byte === 0x27) {
      const quote = byte
      i++
      while (i < buf.length) {
        if (buf[i] === 0x5C) { i += 2; continue }
        if (buf[i] === quote) { i++; break }
        i++
      }
      continue
    }

    // 上下文 3 & 4: 正常花括号
    if (byte === 0x7B) depth++
    else if (byte === 0x7D) {
      depth--
      if (depth === 0) return i + 1  // 函数结束
    }

    i++
  }
  return -1
}
```

### 6.3 幂等性设计

补丁工具必须是幂等的——重复运行不应该导致错误：

```javascript
function applyPatches() {
  // 关键: 始终从 BACKUP 读取原始内容
  const source = existsSync(BACKUP_PATH) ? BACKUP_PATH : CLAUDE_BIN
  let data = readFileSync(source)

  // ... 在 data 上执行查找和替换 ...

  // 写入目标文件
  writeFileSync(CLAUDE_BIN, data)
}
```

### 6.4 macOS 代码签名修复

**关键**：macOS 的 Mach-O 二进制有嵌入式哈希表。修改任何字节后，代码签名验证失败，进程会被 SIGKILL。

```javascript
// 必须在写入后重新签名
writeFileSync(CLAUDE_BIN, data)
execSync(`codesign --force --sign - "${CLAUDE_BIN}"`, { stdio: 'pipe' })
```

没有 `codesign` 的系统（Linux）不需要这一步。

---

## 7. 阶段六：验证 — 确认补丁正确性

### 7.1 多层验证清单

```
□ 字节长度: replacement.length === original.length
□ 签名完整: 替换后仍以 'async function Fa_' 开头
□ 语法有效: 替换内容是合法 JavaScript
□ 功能验证: 替换后包含 Y0( 调用
□ 移除验证: 替换后不含 $6.post (远程 API)
□ 门控移除: 替换后不含 lq()!=="firstParty"
□ 双副本一致: 两个副本都被成功替换
□ 签名修复: codesign 执行成功
□ 幂等性: 重复运行结果相同
□ 可逆性: --restore 能恢复到原始状态
```

### 7.2 诊断模式

实现一个 `--analyze` 模式，在不修改文件的情况下展示系统状态：

```
─── Binary Analysis (Source-Informed) ───

Fa_ function signature: 2 occurrence(s)

  #1 at offset 0x4d95a80:
    ✓ auth gate (lq = isAuthProvider)
    ✓ API endpoint path
    ✓ HTTP client ($6 = axios instance)
    Function length: 695 bytes
    Length in range: ✓
    Uses Y0 (local LLM): NO (original)
    Uses $6.post (remote): YES (original)

wE7 (companion generation, uses Y0/ZP): 2 occurrence(s)
  0x4d96966: Y0=true, ZP=true ✓ works with local API
```

这个输出让用户立即知道：
1. 函数在哪里（偏移量）
2. 是否是原始版本还是已打过补丁
3. 依赖的 Y0/ZP 模式是否可用
4. 可以安全地进行 patch

### 7.3 常见陷阱

| 陷阱 | 症状 | 解决方案 |
|------|------|---------|
| 只 patch 了一个副本 | 功能间歇性失效 | 扫描所有出现位置 |
| 字节长度不匹配 | 二进制损坏 | 动态生成 + 严格检查 |
| 未重签 codesign | macOS SIGKILL | 自动执行 codesign |
| 子串误匹配 | patch 了错误的位置 | 使用多个验证器 |
| 模板字面量中的 `}` | 花括号平衡错误 | 正确处理 `${...}` |
| 正则中的 `{` | 花括号平衡错误 | 处理 `/regex/` 字面量 |

---

## 8. 工具箱

### 8.1 必备工具

| 工具 | 用途 | 安装 |
|------|------|------|
| `strings` | 从二进制提取可读字符串 | 系统自带 |
| `file` | 识别二进制类型 | 系统自带 |
| `codesign` | macOS 代码签名 | 系统自带 |
| `python3` | 快速二进制搜索脚本 | 系统自带 |
| `node` | 运行补丁工具 | nvm / brew |
| `grep` / `ripgrep` | 搜索源码 | brew install ripgrep |

### 8.2 实用脚本集合

#### 搜索二进制中的模式

```python
#!/usr/bin/env python3
"""search_binary.py — 在二进制中搜索 UTF-8 模式"""
import sys
data = open(sys.argv[1], 'rb').read()
pattern = sys.argv[2].encode('utf8')
idx, count = 0, 0
while True:
    idx = data.find(pattern, idx)
    if idx == -1: break
    print(f'Found at 0x{idx:x} ({idx})')
    # 打印前后各 80 字符上下文
    ctx = data[max(0,idx-40):idx+len(pattern)+40]
    print(f'  Context: {ctx.decode("utf8", errors="replace")}')
    idx += 1
    count += 1
print(f'\nTotal: {count} occurrence(s)')
```

#### 比较两个函数的差异

```python
#!/usr/bin/env python3
"""diff_binary.py — 比较两个二进制文件的差异"""
import sys
a, b = open(sys.argv[1],'rb').read(), open(sys.argv[2],'rb').read()
if len(a) != len(b):
    print(f'Size mismatch: {len(a)} vs {len(b)}')
for i in range(min(len(a), len(b))):
    if a[i] != b[i]:
        ctx_a = a[max(0,i-20):i+20].decode('utf8', errors='replace')
        ctx_b = b[max(0,i-20):i+20].decode('utf8', errors='replace')
        print(f'Diff at 0x{i:x}:\n  Original: {ctx_a}\n  Patched:  {ctx_b}')
```

#### 提取两个锚点之间的内容

```python
#!/usr/bin/env python3
"""extract_between.py — 提取两个锚点之间的二进制内容"""
import sys
data = open(sys.argv[1], 'rb').read()
start_pattern = sys.argv[2].encode('utf8')
end_pattern = sys.argv[3].encode('utf8')

start_idx = data.find(start_pattern)
if start_idx == -1:
    print(f'Start pattern not found: {sys.argv[2]}'); sys.exit(1)
end_idx = data.find(end_pattern, start_idx + len(start_pattern))
if end_idx == -1:
    print(f'End pattern not found: {sys.argv[3]}'); sys.exit(1)

chunk = data[start_idx:end_idx + len(end_pattern)]
print(f'Extracted {len(chunk)} bytes from 0x{start_idx:x} to 0x{end_idx+len(end_pattern):x}')
print(chunk.decode('utf8', errors='replace'))
```

---

## 9. 模式速查表

### 9.1 常见混淆模式识别

| 原始代码 | 混淆后 | 识别方法 |
|---------|--------|---------|
| `return true` | `return!0` | 搜索 `return!0` |
| `return false` | `return!1` | 搜索 `return!1` |
| `return undefined` | `return;` | - |
| `if (x === "string")` | `if(x==="string")` | 字符串常量不变 |
| `obj?.prop` | `obj?.prop` | 可选链不变 |
| `async function name()` | `async function Xy()` | 函数名混淆 |
| `import { x }` | 内联，无 import | Bun 全部内联 |
| `class ClassName` | `function Zz()` | 可能降级为构造函数 |

### 9.2 常见 gate check 模式

```javascript
// 模式 1: Auth provider check
if(lq()!=="firstParty")return null   // lq = isAuthProvider

// 模式 2: Feature flag
if(!feature("FLAG_NAME"))return       // feature flag 检查

// 模式 3: Rate limit
if(X3())return null                   // X3 = isRateLimited

// 模式 4: Organization check
if(!T_().oauthAccount?.orgUuid)return // T_ = getGlobalConfig

// 模式 5: Model check
if(!/^claude-(opus|sonnet)-4-6/.test(_))return!1  // 模型名正则

// 模式 6: Circuit breaker
if(C0?.isCircuitBroken()??!1)return!1 // 开关检查

// 绕过策略:
// return null → return value  (翻转)
// return!1    → return!0      (false→true) 或 return!1 → 不改
// if(!feature) → if(!1&&feature)  (永远 false) 或 if(feature)
```

### 9.3 Bun SEA 特有的结构模式

```javascript
// 模块懒加载包装器
var sS7 = G(()=>{
  v7();aK();R8();  // 依赖初始化
  // 模块内容...
});

// React 组件缓存（Compiler 优化）
var $38 = u(iH(), 1);  // React cache hook
function Component(H) {
  let _ = $38.c(26);    // 缓存容器
  // ...
}

// 全局配置访问
T_()              // getGlobalConfig()
T_().companion    // 读取 companion 设置
I_((z) => ({...z, companionMuted: true}))  // 更新配置

// HTTP 客户端
$6.post(url, body, {headers: {...}, timeout: 1e4})

// 本地 LLM 调用（Buddy 系统专用）
Y0({querySource: "xxx", model: ZP(), messages: [...], signal: $})
```

---

## 10. 实战案例回顾

### 10.1 案例：Auto Mode Unlock

**目标**：解除 Claude Code auto 模式的所有入口限制

**策略**：精确等长替换（6 个 patch 点）

**关键发现**：
- auto 模式有 6 层检查：provider → model regex → gate enabled → circuit breaker → canEnter → carousel
- 每层都是一个简单的布尔返回值，可以翻转 `!0`/`!1` 或 `if(w)` → `if(1)`
- 所有 patch 都是单字符改动（`0` → `1`），非常安全

**难度**：★★☆☆☆

### 10.2 案例：Buddy Reaction Unlock

**目标**：让 buddy companion 功能在第三方 API 下工作

**策略**：锚点定位 + 动态替换（替换整个函数体）

**关键发现**：
- `Fa_` 被 4 层门控保护，但根本问题是远程 API 不可用
- 需要替换整个函数，不能只绕过门控
- `wE7`（companion 生成）已经在用 `Y0`/`ZP()`（本地 LLM），证明这条路径可行
- Bun SEA 中 JS 出现两次，必须都 patch

**难度**：★★★★☆

### 10.3 难度评估维度

| 维度 | Auto Mode | Buddy |
|------|-----------|-------|
| 定位难度 | 低（6 个短模式） | 中（需要理解函数结构） |
| 替换复杂度 | 低（翻转布尔值） | 高（替换 695 字节函数体） |
| 依赖关系 | 无（独立检查点） | 高（需要 Y0/ZP/O1 已存在） |
| 版本稳定性 | 低（混淆名不稳定） | 中（函数签名更稳定） |
| 风险 | 低（单字符改动） | 中（整体替换） |

---

## 附录 A：完整流程检查清单

```
□ 确认二进制类型（Mach-O/ELF/WASM）
□ 确认 JS 源码是否嵌入
□ 检查是否有原始 TypeScript 源码可用
□ 使用 strings 提取关键字符串常量
□ 定位目标函数（偏移量 + 出现次数）
□ 确认双重副本
□ 建立混淆名 → 真实名映射表
□ 识别已验证模式（如 Y0/ZP）
□ 分析 gate check 结构
□ 选择最小修改策略
□ 设计替换函数
□ 验证字节长度对齐
□ 实现花括号平衡扫描
□ 实现多验证器
□ 创建备份机制
□ 实现 codesign 重签
□ 实现 --check 模式
□ 实现 --analyze 模式
□ 实现 --restore 模式
□ 测试幂等性
□ 测试可逆性
```

---

## 附录 B：术语表

| 术语 | 含义 |
|------|------|
| SEA | Single Executable Application — Node/Bun 将 JS 打包成单一可执行文件 |
| Mach-O | macOS 的可执行文件格式 |
| `__TEXT` | Mach-O 中的代码段，存储可执行代码和只读数据 |
| codesign | macOS 代码签名工具 |
| 混淆 (minification) | 将变量名缩短、删除空格，使代码难以阅读 |
| 锚点 (anchor) | 用于在二进制中定位目标代码的稳定字符串模式 |
| 验证器 (validator) | 用于确认锚点位置正确的额外检查 |
| 等长替换 | 替换内容的字节数必须与原始内容完全相同 |
| 花括号平衡 | 统计 `{` 和 `}` 的数量来确定代码块边界 |
| 门控 (gate) | 阻止特定条件下的代码执行的检查逻辑 |
| 幂等 (idempotent) | 重复执行产生相同结果 |
| NOP 填充 | 用空操作指令填充被移除的代码空间 |
| 作用域 (scope) | JavaScript 中变量可访问的范围 |
| 已验证模式 (proven pattern) | 在其他地方已经确认工作正常的代码模式 |
