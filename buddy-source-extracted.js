/**
 * Claude Code Buddy System — 从二进制提取的源码（minified）
 *
 * 关键函数对照表：
 *   Fa_    = buddyReact()          — buddy reaction API 调用
 *   KE7    = fireCompanionObserver — 每轮对话后触发 reaction
 *   OE7    = hatchReaction         — 孵化时触发 reaction
 *   $E7    = petReaction           — pet 时触发 reaction
 *   UP5    = buildTranscript       — 构建对话摘要
 *   tS7    = extractToolOutput     — 提取 tool output
 *   oP5    = detectSpecialReason  — 检测 test-fail/error/large-diff
 *   aP5    = isAddressedByName    — 检测是否被叫名字
 *   H38    = pushRecentReaction   — 保存最近 reaction（最多3条）
 *   qE7    = getLastReaction      — 获取最后一条 reaction
 *   wE7    = generateCompanion    — 生成 companion (name+personality)
 *   Qa_    = isBuddyAvailable     — 永远返回 true（已硬编码）
 *   eP5    = pickInspirationWords — 从词池选灵感词
 *   sP5    = getProjectContext    — 读取 package.json + git log
 *
 * 常量：
 *   QP5 = 30000  (30秒 rate limit)
 *   lP5 = 3      (最近 reaction 最多保存3条)
 *   nP5 = 80     (diff 行数阈值)
 */

// ========================================================================
// Fa_ — buddy reaction API 调用（核心函数，需要被 patch）
// ========================================================================
async function Fa_(H, _, q, K, O, $) {
  // H = companion {name, personality, species, rarity, stats}
  // _ = transcript (对话摘要，最多5000字符)
  // q = reason ("turn" | "error" | "test-fail" | "large-diff" | "hatch" | "pet")
  // K = recent reactions (最多3条)
  // O = addressed (是否被叫名字)
  // $ = AbortSignal

  // ❌ 这里是问题所在：firstParty 检查阻止了第三方 API
  if (lq() !== "firstParty") return null;  // lq() = isAuthProvider()
  if (X3()) return null;                    // X3() = isRateLimited()

  let T = T_().oauthAccount?.organizationUuid;  // T_() = getGlobalConfig()
  if (!T) return null;

  try {
    await W3();  // refreshTokenIfNecessary()
    let z = Kq()?.accessToken;  // getAuth()
    if (!z) return null;

    let A = `${B8().BASE_API_URL}/api/organizations/${T}/claude_code/buddy_react`;
    return (
      await $6.post(A, {
        name: H.name.slice(0, 32),
        personality: H.personality.slice(0, 200),
        species: H.species,
        rarity: H.rarity,
        stats: H.stats,
        transcript: _.slice(0, 5000),
        reason: q,
        recent: K.map((Y) => Y.slice(0, 200)),
        addressed: O,
      }, {
        headers: {
          Authorization: `Bearer ${z}`,
          "anthropic-beta": qD,       // beta header
          "User-Agent": J$(),          // userAgent()
        },
        timeout: 1e4,  // 10秒超时
        signal: $,
      })
    ).data.reaction?.trim() || null;
  } catch (z) {
    return h(`[buddy] api failed: ${z}`, { level: "debug" }), null;
  }
}

// ========================================================================
// KE7 — fireCompanionObserver（每轮对话后调用）
// ========================================================================
function KE7(H, _) {
  // H = messages 数组
  // _ = callback(reaction) 设置 companionReaction

  let q = Ab();  // getCompanion()
  if (!q || T_().companionMuted) {  // T_() = getGlobalConfig()
    eO8 = H.length;
    return;
  }

  let K = aP5(H, q.name);           // 是否被叫名字
  let O = tS7(H.slice(eO8));        // 新消息中的 tool output
  eO8 = H.length;
  let $ = tS7(H.slice(-12));        // 最近12条消息的 tool output
  let T = K ? null : oP5(O);        // 特殊原因（test-fail/error/large-diff）
  let z = T ?? "turn";              // 默认 reason = "turn"
  let A = Date.now();

  // ❌ 30秒 rate limit（如果没被叫名字也没特殊原因）
  if (!K && !T && A - Ua_ < QP5) return;  // QP5 = 30000ms

  let w = UP5(H, $);                // 构建对话摘要
  if (!w.trim()) return;

  Ua_ = A;                          // 更新最后触发时间
  Fa_(q, w, z, RIH, K, AbortSignal.timeout(1e4))  // ❌ 调用远程 API
    .then((Y) => {
      if (!Y) return;
      H38(Y);       // 保存 reaction 到历史
      _(Y);          // callback → setAppState
    });
}

// ========================================================================
// OE7 — hatchReaction（孵化时触发）
// ========================================================================
function OE7(H, _) {
  if (T_().companionMuted) return;
  Ua_ = Date.now();
  sP5()  // getProjectContext() — 读取 package.json + git log
    .then((q) => Fa_(H, q || "(fresh project, nothing to see yet)", "hatch", [], false, AbortSignal.timeout(1e4)))
    .then((q) => {
      if (!q) return;
      H38(q);
      _(q);
    })
    .catch(() => {});
}

// ========================================================================
// $E7 — petReaction（pet 时触发）
// ========================================================================
function $E7(H) {
  let _ = Ab();
  if (!_) return;
  Ua_ = Date.now();
  Fa_(_, "(you were just petted)", "pet", RIH, false, AbortSignal.timeout(1e4))
    .then((q) => {
      if (!q) return;
      H38(q);
      H(q);  // 注意：这里直接传 setAppState，和 KE7/OE7 不同的 callback
    });
}

// ========================================================================
// UP5 — buildTranscript（构建对话摘要）
// ========================================================================
function UP5(H, _) {
  let q = [], K = H.slice(-12);  // 取最近12条消息
  for (let O of K) {
    if (O.type !== "user" && O.type !== "assistant") continue;
    if (O.isMeta) continue;
    let $ = O.type === "user" ? OU(O) : ujH(O);  // 提取文本
    if ($) q.push(`${O.type === "user" ? "user" : "claude"}: ${$.slice(0, 300)}`);
  }
  if (_) q.push(`[tool output]\n${_.slice(-1000)}`);
  return q.join("\n");
}

// ========================================================================
// tS7 — extractToolOutput（从消息中提取 tool output）
// ========================================================================
function tS7(H) {
  let _ = [];
  for (let q of H) {
    if (q.type !== "user") continue;
    let K = q.message.content;
    if (typeof K === "string") continue;
    for (let O of K) {
      if (O.type !== "tool_result") continue;
      let $ = O.content;
      if (typeof $ === "string") _.push($);
      else if (Array.isArray($)) {
        for (let T of $) if (T.type === "text") _.push(T.text);
      }
    }
  }
  return _.join("\n");
}

// ========================================================================
// oP5 — detectSpecialReason（检测特殊触发原因）
// ========================================================================
function oP5(H) {
  if (!H) return null;
  if (iP5.test(H)) return "test-fail";   // test 失败模式
  if (rP5.test(H)) return "error";        // error 模式
  if (/^(@@ |diff )/m.test(H)) {
    if ((H.match(/^[+-](?![+-])/gm)?.length ?? 0) > nP5) return "large-diff";  // >80行 diff
  }
  return null;
}

// ========================================================================
// aP5 — isAddressedByName（检测是否被叫名字）
// ========================================================================
function aP5(H, _) {
  let q = H.findLast(djH);  // 最后一条 user 消息
  if (!q) return false;
  let K = OU(q) ?? "";
  return new RegExp(`\\b${_.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(K);
}

// ========================================================================
// wE7 — generateCompanion（生成 name + personality）
// 使用 Y0（本地 LLM）+ ZP()（haiku 模型）✅ 这个函数不需要 patch
// ========================================================================
async function wE7(H, _, q) {
  let K = eP5(_, 4);  // 从 inspirationSeed 选4个词
  let O = _o.map((T) => `${T}:${H.stats[T]}`).join(" ");
  let $ = `Generate a companion.
Rarity: ${H.rarity.toUpperCase()}
Species: ${H.species}
Stats: ${O}
Inspiration words: ${K.join(", ")}
${H.shiny ? "SHINY variant — extra special." : ""}
Make it memorable and distinct.`;

  try {
    let T = await Y0({           // ✅ 本地 LLM 调用
      querySource: "buddy_companion",
      model: ZP(),               // ✅ 配置的 haiku 模型
      system: tP5,               // companion generation system prompt
      skipSystemPromptPrefix: true,
      messages: [{ role: "user", content: $ }],
      output_format: { type: "json_schema", schema: yg(TE7()) },
      max_tokens: 512,
      temperature: 1,
      signal: q,
    });
    let z = O1(T.content);       // ✅ 提取文本
    // ... 解析 JSON schema
    return A.data;
  } catch (T) {
    return HJ5(H);  // fallback name
  }
}

// ========================================================================
// Qa_ — isBuddyAvailable（已硬编码为 true）
// ========================================================================
function Qa_() {
  return !0;  // 永远返回 true — 大量空格填充是因为原来有个 feature flag
}

// ========================================================================
// sP5 — getProjectContext（读取项目信息）
// ========================================================================
async function sP5() {
  let H = W_();  // getProjectRoot()
  let [_, q] = await Promise.allSettled([
    HE7.readFile(_E7.join(H, "package.json"), "utf-8"),
    H6(C8(), ["--no-optional-locks", "log", "--oneline", "-n", "3"], { preserveOutputOnError: false, useCwd: true }),
  ]);
  let K = [];
  if (_.status === "fulfilled") {
    try {
      let O = c_(_.value);  // JSON.parse
      if (O.name) K.push(`project: ${O.name}${O.description ? ` — ${O.description}` : ""}`);
    } catch {}
  }
  if (q.status === "fulfilled") {
    let O = q.value.stdout.trim();
    if (O) K.push(`recent commits:\n${O}`);
  }
  return K.join("\n");
}

// ========================================================================
// 常量
// ========================================================================
var QP5 = 30000;   // 30秒 rate limit
var lP5 = 3;       // 最近 reaction 最多3条
var nP5 = 80;      // diff 行数阈值（超过80行触发 large-diff）
var iP5 = /\b[1-9]\d* (failed|failing)\b|\btests? failed\b|^FAIL(ED)?\b| ✗ | ✘ /im;
var rP5 = /\berror:|\bexception\b|\btraceback\b|\bpanicked at\b|\bfatal:|exit code [1-9]/i;
var Ua_ = 0;       // 最后触发时间
var eO8 = 0;       // 消息长度追踪
var RIH = [];      // 最近 reactions 数组

// ========================================================================
// /buddy 命令实现
// ========================================================================
var jJ5 = {
  type: "local-jsx",
  name: "buddy",
  description: "Hatch a coding companion · pet, off",
  argumentHint: "[pet|off]",
  get isHidden() { return !Qa_(); },
  immediate: true,
  load: () => Promise.resolve({
    async call(H, _, q) {
      let K = T_();  // getGlobalConfig()
      let O = q?.trim();

      if (O === "off") {
        if (K.companionMuted !== true) I_((z) => ({ ...z, companionMuted: true }));
        return H("companion muted", { display: "system" }), null;
      }
      if (O === "on") {
        if (K.companionMuted === true) I_((z) => ({ ...z, companionMuted: false }));
        return H("companion unmuted", { display: "system" }), null;
      }
      if (!Qa_()) return H("buddy is unavailable on this configuration", { display: "system" }), null;

      if (O === "pet") {
        let z = Ab();
        if (!z) return H("no companion yet · run /buddy first", { display: "system" }), null;
        if (K.companionMuted === true) I_((A) => ({ ...A, companionMuted: false }));
        _.setAppState((A) => ({ ...A, companionPetAt: Date.now() }));
        $E7(RE7(_.setAppState));  // 触发 pet reaction
        return H(`petted ${z.name}`, { display: "system" }), null;
      }

      if (K.companionMuted === true) I_((z) => ({ ...z, companionMuted: false }));

      let $ = Ab();
      if ($) return React.createElement(na_, { companion: $, lastReaction: qE7(), onDone: H });  // 显示 info 卡

      // 没有 companion → 孵化
      let T = fJ5(yC6(VC6()));  // roll + generate
      return T.then((z) => OE7(z, RE7(_.setAppState))).catch(() => {}),
        React.createElement(XE7, { hatching: T, onDone: H });  // 显示孵化动画
    }
  }),
};

// ========================================================================
// companion generation system prompt
// ========================================================================
var tP5 = `You generate coding companions — small creatures that live in a developer's terminal and occasionally comment on their work.
Given a rarity, species, stats, and a handful of inspiration words, invent:
- A name: ONE word, max 12 characters. Memorable, slightly absurd. No titles, no "the X", no epithets. Think pet name, not NPC name. The inspiration words are loose anchors — riff on one, mash two syllables, or just use the vibe. Examples: Pith, Dusker, Crumb, Brogue, Sprocket.
- A one-sentence personality (specific, funny, a quirk that affects how they'd comment on code — should feel consistent with the stats)
Higher rarity = weirder, more specific, more memorable. A legendary should be genuinely strange.
Don't repeat yourself — every companion should feel distinct.`;

// ========================================================================
// REPL.tsx 中的调用
// ========================================================================
// 每轮对话结束后：
// if (feature('BUDDY')) {
//   void fireCompanionObserver(messagesRef.current, reaction => setAppState(prev =>
//     prev.companionReaction === reaction ? prev : { ...prev, companionReaction: reaction }
//   ));
// }
