#!/usr/bin/env node
/**
 * Claude Code Buddy Reaction Patcher — Source-Informed Edition
 *
 * Based on analysis of:
 *   buddy-source-extracted.js  — complete buddy system source (from binary)
 *   buddy/types.ts              — CompanionBones/CompanionSoul type definitions
 *   buddy/companion.ts          — roll/generation logic, hashString, mulberry32
 *   buddy/prompt.ts             — companion intro system prompt
 *
 * ═══════════════════════════════════════════════════════════════════
 * SOURCE ARCHITECTURE (from buddy-source-extracted.js)
 * ═══════════════════════════════════════════════════════════════════
 *
 *   Fa_ = buddyReact() — the function we patch
 *     Params: (companion, transcript, reason, recentReactions, addressed, signal)
 *     Gate 1: lq() !== "firstParty"  →  blocks 3rd-party API providers
 *     Gate 2: X3()                   →  rate limit check
 *     Gate 3: oauthAccount?.organizationUuid  →  requires org membership
 *     Gate 4: Kq()?.accessToken      →  requires OAuth access token
 *     Action: POST /api/organizations/{org}/claude_code/buddy_react
 *     Returns: reaction text or null
 *
 *   wE7 = generateCompanion() — already works with local LLM
 *     Uses Y0({querySource:"buddy_companion", model:ZP(), ...})
 *     ✅ PROOF: Y0/ZP works with ANTHROPIC_BASE_URL (3rd-party API)
 *
 *   Strategy: Replace Fa_ body with same Y0/ZP pattern that wE7 uses.
 *             This bypasses ALL four gates and uses the local LLM directly.
 *
 * ═══════════════════════════════════════════════════════════════════
 * PATCHING APPROACH (source-informed, not blind byte matching)
 * ═══════════════════════════════════════════════════════════════════
 *
 *   Phase 1: LOCATE — find function via stable minified signature
 *     Anchor: "async function Fa_(H,_,q,K,O,$){"  (2 occurrences in binary)
 *     This is the minified name for buddyReact — stable within a version.
 *
 *   Phase 2: VALIDATE — confirm with source-derived structural patterns
 *     Must contain: lq()!=="firstParty"  (auth gate from source line 38)
 *     Must contain: buddy_react           (API endpoint from source line 49)
 *     Must contain: $6.post               (HTTP client from source line 51)
 *     Optional:     oauthAccount          (org UUID check from source line 41)
 *
 *   Phase 3: BOUNDARY — find function end via balanced-brace scanning
 *     Handles template literals (`${...}`) correctly
 *     Handles string literals (quoted braces) correctly
 *     Expected: ~695 bytes (validated against source)
 *
 *   Phase 4: REPLACE — generate same-length local LLM replacement
 *     Uses Y0 (local LLM call) + ZP() (configured haiku model) + O1 (text extract)
 *     Incorporates companion personality, stats, and reason context
 *     Dynamic padding to match exact original byte length
 *
 *   Phase 5: VERIFY — post-patch validation
 *     Confirm replacement is syntactically valid
 *     Confirm byte lengths match exactly
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync, realpathSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

const rawBin = process.env.CLAUDE_BIN || findClaudeBinary()
const CLAUDE_BIN = lstatSync(rawBin).isSymbolicLink() ? realpathSync(rawBin) : rawBin
const BACKUP_PATH = CLAUDE_BIN + '.buddy-backup'

// ═══════════════════════════════════════════════════════════════════
// Source-derived anchors and validators
// ═══════════════════════════════════════════════════════════════════
//
// From buddy-source-extracted.js analysis:
//   Fa_ = buddyReact — minified from buddy_react module
//   The minified name "Fa_" is stable within version 2.1.96 but may
//   change across major versions. The function signature pattern is
//   more reliable than matching the entire function body.

// Primary anchor — the function signature (minified)
// Source: async function buddyReact(companion, transcript, reason, recent, addressed, signal)
// Minified: async function Fa_(H,_,q,K,O,$)
const FUNC_SIGNATURE = Buffer.from('async function Fa_(H,_,q,K,O,$){', 'utf8')

// Validation patterns — must ALL be found within the function body
// These are derived from source analysis of Fa_'s internal structure
const VALIDATORS = [
  { pattern: Buffer.from('lq()!=="firstParty"', 'utf8'),
    desc: 'auth gate (lq = isAuthProvider)' },
  { pattern: Buffer.from('buddy_react', 'utf8'),
    desc: 'API endpoint path' },
  { pattern: Buffer.from('$6.post', 'utf8'),
    desc: 'HTTP client ($6 = axios instance)' },
]

// Expected function length range (source analysis: ~695 bytes)
const EXPECTED_LEN_MIN = 600
const EXPECTED_LEN_MAX = 900

// ═══════════════════════════════════════════════════════════════════
// Replacement function generator
// ═══════════════════════════════════════════════════════════════════
//
// Design decisions (from source analysis):
//
// 1. Y0 is the local LLM call function — same one used by wE7 (companion generation)
//    It respects ANTHROPIC_BASE_URL, so it works with 3rd-party providers.
//
// 2. ZP() returns the configured haiku model (ANTHROPIC_DEFAULT_HAIKU_MODEL)
//    This is set to e.g. "GLM-5V-Turbo" for bigmodel.cn users.
//
// 3. O1() extracts text from LLM response content blocks
//    Used by wE7: `O1(T.content)` where T = Y0 response
//
// 4. h() is the debug logger — we keep the same catch pattern as original Fa_
//    Original: `catch(z){return h(\`[buddy] api failed: ${z}\`,{level:"debug"}),null}`
//
// 5. The prompt incorporates:
//    - Companion personality (H.personality) — from source: max 200 chars
//    - Stats (H.stats) — from source: {DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK}
//    - Reason (q) — "turn"|"error"|"test-fail"|"large-diff"|"hatch"|"pet"
//    - Transcript (_) — conversation summary, max 5000 chars
//    - Recent reactions (K) — last 3 reactions for context
//
// 6. We use Chinese (简体中文) in the prompt as requested by the user.

function generateReplacement(originalLen) {
  // Base replacement — mirrors wE7's Y0/ZP pattern but for reactions
  let body =
    'try{' +
    // Build prompt from companion context (source-informed)
    'var p="You are "+H.name+", "+H.rarity+" "+H.species+". Personality: "+H.personality' +
    '+"; Stats: SNARK="+H.stats.SNARK+",CHAOS="+H.stats.CHAOS+",WISDOM="+H.stats.WISDOM' +
    '+";\\nReason: "+q+";\\nRecent chat:\\n"+_+"\\n\\n"' +
    '+"Respond as "+H.name+" in 1-2 short witty sentences about code. Use Chinese(简体中文)."' +
    // Call local LLM (same Y0/ZP/O1 pattern as wE7)
    ';var T=await Y0({querySource:"buddy_react_local",model:ZP(),' +
    'messages:[{role:"user",content:p}],max_tokens:200,temperature:1,signal:$})' +
    ';var z=O1(T.content)' +
    ';return z?z.trim():null}' +
    // Keep same error handling as original Fa_
    'catch(T){return h("[buddy] api failed: "+T,{level:"debug"}),null}'

  let funcBody = '{' + body + '}'
  let fullFunc = 'async function Fa_(H,_,q,K,O,$)' + funcBody

  // Validate replacement is syntactically valid JavaScript before padding
  try {
    new Function(fullFunc)
  } catch (e) {
    throw new Error(`Generated replacement has invalid JS syntax: ${e.message}`)
  }

  let buf = Buffer.from(fullFunc, 'utf8')

  // Pad to match original length — insert spaces before 'catch' (valid JS whitespace)
  if (buf.length < originalLen) {
    const diff = originalLen - buf.length
    const insertAt = funcBody.indexOf('}catch(T)')
    if (insertAt === -1) {
      throw new Error('Padding anchor "}catch(T)" not found in generated replacement')
    }
    funcBody = funcBody.slice(0, insertAt + 1) + ' '.repeat(diff) + funcBody.slice(insertAt + 1)
    fullFunc = 'async function Fa_(H,_,q,K,O,$)' + funcBody
    buf = Buffer.from(fullFunc, 'utf8')
  }

  return buf
}

// ═══════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════

const mode = process.argv[2] || '--patch'

if (mode === '--help' || mode === '-h') {
  console.log(`
Claude Code Buddy Reaction Patcher — Source-Informed Edition

Usage:
  node claude-buddy-patcher.mjs           Apply patches (source-informed)
  node claude-buddy-patcher.mjs --check   Check current patch status
  node claude-buddy-patcher.mjs --restore Restore original binary
  node claude-buddy-patcher.mjs --analyze Analyze binary (debug, no changes)

Environment:
  CLAUDE_BIN=<path>   Path to claude binary (auto-detected if not set)

Patching strategy:
  Phase 1: Locate Fa_ via stable function signature anchor
  Phase 2: Validate with source-derived structural patterns
  Phase 3: Find function boundary via balanced-brace scanning
  Phase 4: Generate same-length Y0/ZP local LLM replacement
  Phase 5: Verify post-patch integrity
`)
  process.exit(0)
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

function main() {
  console.log(`Claude Code Buddy Reaction Patcher — Source-Informed Edition`)
  console.log(`Binary: ${CLAUDE_BIN}`)
  console.log()

  if (!existsSync(CLAUDE_BIN)) {
    console.error(`Error: Binary not found at ${CLAUDE_BIN}`)
    console.error('Set CLAUDE_BIN environment variable to the correct path.')
    process.exit(1)
  }

  switch (mode) {
    case '--check':
      checkPatches()
      break
    case '--restore':
      restoreBinary()
      break
    case '--analyze':
      analyzeBinary()
      break
    case '--patch':
    default:
      applyPatches()
      break
  }
}

// ═══════════════════════════════════════════════════════════════════
// Binary detection
// ═══════════════════════════════════════════════════════════════════

function findClaudeBinary() {
  const candidates = [
    '/usr/local/bin/claude',
    `${process.env.HOME}/.local/bin/claude`,
  ]

  try {
    const which = execSync('command -v claude 2>/dev/null || true', {
      encoding: 'utf8',
      shell: '/bin/bash',
    }).trim()
    if (which && !which.includes('alias')) {
      candidates.unshift(which)
    }
  } catch {}

  for (const path of candidates) {
    if (existsSync(path)) return resolve(path)
  }

  console.error('Could not auto-detect claude binary. Set CLAUDE_BIN=/path/to/claude')
  process.exit(1)
}

// ═══════════════════════════════════════════════════════════════════
// Balanced-brace scanner — finds function boundaries
// ═══════════════════════════════════════════════════════════════════
//
// Correctly handles:
//   - Template literals: `${expr}` — braces inside are expression-scoped
//   - String literals: "..." and '...' — braces inside are ignored
//   - Escape sequences: \`, \", \' — don't break delimiter detection

function findFunctionEnd(buf, startOffset) {
  // startOffset should point to the opening '{' of the function body
  let depth = 0
  let i = startOffset

  // Track previous non-whitespace byte for regex detection:
  // A '/' is a regex literal only after '(', '=', ',', ';', '[', '{', '!', '&', '|', '?', ':', '~', '^', '}', or start of input.
  // Otherwise '/' is a division operator.
  let prevSignificantByte = 0x28 // '(' — assume function context

  while (i < buf.length) {
    const byte = buf[i]

    // Regex literal /pattern/flags
    // Heuristic: '/' after '=', '(', ',', ';', '[', '{', '!', '&', '|', '?', ':', '~', '^', '}', or newline
    if (byte === 0x2F && isRegexContext(prevSignificantByte)) {
      i++ // skip opening /
      while (i < buf.length) {
        if (buf[i] === 0x5C) { i += 2; continue } // escaped char
        if (buf[i] === 0x5B) { // character class [...]
          i++
          while (i < buf.length) {
            if (buf[i] === 0x5C) { i += 2; continue }
            if (buf[i] === 0x5D) { i++; break }
            i++
          }
          continue
        }
        if (buf[i] === 0x2F) { i++; break } // closing /
        i++
      }
      // Skip regex flags (g, i, m, s, u, y, d, v)
      while (i < buf.length && /[gimsuydv]/.test(String.fromCharCode(buf[i]))) i++
      prevSignificantByte = 0x2F // '/'
      continue
    }

    // Template literal (backtick)
    if (byte === 0x60) {
      i++ // skip opening backtick
      while (i < buf.length) {
        if (buf[i] === 0x5C) { i += 2; continue } // escaped char
        if (buf[i] === 0x60) { i++; break }        // closing backtick
        // Template expression ${...}
        if (buf[i] === 0x24 && i + 1 < buf.length && buf[i + 1] === 0x7B) {
          i += 2 // skip ${
          let exprDepth = 1
          while (i < buf.length && exprDepth > 0) {
            if (buf[i] === 0x7B) exprDepth++
            else if (buf[i] === 0x7D) exprDepth--
            if (exprDepth > 0) i++
          }
          i++ // skip closing }
          continue
        }
        i++
      }
      prevSignificantByte = 0x60
      continue
    }

    // String literal (" or ')
    if (byte === 0x22 || byte === 0x27) {
      const quote = byte
      i++ // skip opening quote
      while (i < buf.length) {
        if (buf[i] === 0x5C) { i += 2; continue } // escaped char
        if (buf[i] === quote) { i++; break }        // closing quote
        i++
      }
      prevSignificantByte = quote
      continue
    }

    // Braces
    if (byte === 0x7B) { // {
      depth++
    } else if (byte === 0x7D) { // }
      depth--
      if (depth === 0) return i + 1 // past closing }
    }

    // Track significant byte (skip whitespace)
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0A && byte !== 0x0D) {
      prevSignificantByte = byte
    }
    i++
  }

  return -1 // unbalanced — error
}

function isRegexContext(prevByte) {
  // '/' is a regex literal after these bytes:
  // ( = , ; [ { ! & | ? : ~ ^ } newline
  return prevByte === 0x28 || prevByte === 0x3D || prevByte === 0x2C ||
         prevByte === 0x3B || prevByte === 0x5B || prevByte === 0x7B ||
         prevByte === 0x21 || prevByte === 0x26 || prevByte === 0x7C ||
         prevByte === 0x3F || prevByte === 0x3A || prevByte === 0x7E ||
         prevByte === 0x5E || prevByte === 0x7D || prevByte === 0x0A ||
         prevByte === 0x0D
}

// ═══════════════════════════════════════════════════════════════════
// Patch operations
// ═══════════════════════════════════════════════════════════════════

function applyPatches() {
  if (!existsSync(BACKUP_PATH)) {
    console.log('Creating backup...')
    copyFileSync(CLAUDE_BIN, BACKUP_PATH)
    console.log(`  Backup: ${BACKUP_PATH}`)
  } else {
    console.log('Backup already exists, skipping.')
  }

  // Read the BACKUP (original) for consistent patching
  // This ensures re-running the patcher is idempotent
  const source = existsSync(BACKUP_PATH) ? BACKUP_PATH : CLAUDE_BIN
  let data = readFileSync(source)

  console.log('\n─── Phase 1: LOCATE ───')
  const funcIndices = findAllOccurrences(data, FUNC_SIGNATURE)
  console.log(`  Anchor "async function Fa_(H,_,q,K,O,$){": ${funcIndices.length} occurrence(s)`)

  if (funcIndices.length === 0) {
    console.error('  FATAL: Function signature not found.')
    console.error('  This binary version may have different minified names.')
    console.error('  Try: node claude-buddy-patcher.mjs --analyze')
    process.exit(1)
  }

  let patchCount = 0

  for (let fi = 0; fi < funcIndices.length; fi++) {
    const offset = funcIndices[fi]
    console.log(`\n─── Processing occurrence #${fi + 1} at offset 0x${offset.toString(16)} ───`)

    // Phase 2: VALIDATE
    console.log('  Phase 2: VALIDATE')
    let valid = true
    for (const v of VALIDATORS) {
      // Search within a reasonable window after the function start
      const window = data.subarray(offset, Math.min(offset + 1000, data.length))
      const found = window.indexOf(v.pattern) !== -1
      const status = found ? 'OK' : 'MISSING'
      console.log(`    ${status}  ${v.desc}`)
      if (!found) valid = false
    }

    if (!valid) {
      console.log('  SKIP: validation failed — this may not be the Fa_ function')
      continue
    }

    // Phase 3: BOUNDARY
    console.log('  Phase 3: BOUNDARY')
    // The '{' is the last byte of the signature
    const bodyStart = offset + FUNC_SIGNATURE.length - 1

    const funcEnd = findFunctionEnd(data, bodyStart)
    if (funcEnd === -1) {
      console.error('  FATAL: Could not find balanced function end')
      continue
    }

    const funcLen = funcEnd - offset
    console.log(`    Function length: ${funcLen} bytes`)

    if (funcLen < EXPECTED_LEN_MIN || funcLen > EXPECTED_LEN_MAX) {
      console.warn(`    WARN: Expected ${EXPECTED_LEN_MIN}-${EXPECTED_LEN_MAX} bytes, got ${funcLen}`)
      console.warn(`    This might be a different version — proceed with caution`)
    }

    // Phase 4: REPLACE
    console.log('  Phase 4: REPLACE')
    let replacement
    try {
      replacement = generateReplacement(funcLen)
    } catch (e) {
      console.error(`    FATAL: ${e.message}`)
      continue
    }

    if (replacement.length !== funcLen) {
      console.error(`    FATAL: Length mismatch! Original=${funcLen}, Replacement=${replacement.length}`)
      continue
    }

    // Verify replacement doesn't break JS syntax (basic check)
    const replacementStr = replacement.toString('utf8')
    if (!replacementStr.startsWith('async function Fa_')) {
      console.error('    FATAL: Replacement doesn\'t start with function signature')
      continue
    }

    replacement.copy(data, offset)
    console.log(`    OK: Replaced ${funcLen} bytes with local LLM (Y0/ZP) version`)
    patchCount++
  }

  if (patchCount === 0) {
    console.log('\nNo patches applied.')
    if (funcIndices.length === 0) {
      console.log('Binary may already be patched or version incompatible.')
    }
    return
  }

  // Write patched binary
  writeFileSync(CLAUDE_BIN, data)

  // Phase 5: VERIFY
  console.log('\n─── Phase 5: VERIFY ───')
  const patched = readFileSync(CLAUDE_BIN)
  const patchedIndices = findAllOccurrences(patched, FUNC_SIGNATURE)
  for (const idx of patchedIndices) {
    const funcText = patched.subarray(idx, Math.min(idx + 50, patched.length)).toString('utf8')
    const hasY0 = patched.subarray(idx, Math.min(idx + 800, patched.length)).indexOf(Buffer.from('Y0(')) !== -1
    const hasLocal = patched.subarray(idx, Math.min(idx + 800, patched.length)).indexOf(Buffer.from('buddy_react_local')) !== -1
    console.log(`  0x${idx.toString(16)}: ${hasY0 ? 'Y0 ✓' : 'Y0 ✗'} ${hasLocal ? 'local ✓' : 'local ✗'}`)
  }

  // Re-sign the binary — CRITICAL on macOS!
  console.log('\nRe-signing binary (fixing macOS code signature)...')
  try {
    execSync(`codesign --force --sign - "${CLAUDE_BIN}"`, { stdio: 'pipe' })
    console.log('  Code signature updated.')
  } catch (e) {
    console.error('  WARNING: codesign failed. Binary may not launch on macOS.')
    console.error('  Try running: codesign --force --sign - "' + CLAUDE_BIN + '"')
  }

  console.log(`\n✅ Patched ${patchCount}/${funcIndices.length} function(s) successfully.`)
  console.log(`Buddy reactions now use local LLM (Y0 + ZP() = ANTHROPIC_DEFAULT_HAIKU_MODEL).`)
  console.log(`Restore with: node ${process.argv[1]} --restore`)
}

function checkPatches() {
  if (!existsSync(BACKUP_PATH)) {
    console.log('Status: NOT PATCHED (no backup found)')
    return
  }

  const current = readFileSync(CLAUDE_BIN)
  const original = readFileSync(BACKUP_PATH)

  // Check: are the original patterns gone and replaced?
  const origFuncs = findAllOccurrences(original, FUNC_SIGNATURE)
  const currFuncs = findAllOccurrences(current, FUNC_SIGNATURE)

  console.log(`Fa_ function occurrences: ${origFuncs.length} (original) → ${currFuncs.length} (current)`)

  for (let i = 0; i < currFuncs.length; i++) {
    const idx = currFuncs[i]
    const window = current.subarray(idx, Math.min(idx + 800, current.length))
    const hasLocalLLM = window.indexOf(Buffer.from('Y0(')) !== -1
    const hasAuthGate = window.indexOf(Buffer.from('lq()!=="firstParty"')) !== -1
    // Distinguish original (buddy_react URL) from patched (buddy_react_local querySource)
    const hasRemoteAPI = window.indexOf(Buffer.from('$6.post')) !== -1

    if (hasLocalLLM && !hasRemoteAPI && !hasAuthGate) {
      console.log(`  0x${idx.toString(16)}: ✅ PATCHED (local LLM, no remote API, no auth gate)`)
    } else if (hasRemoteAPI && hasAuthGate) {
      console.log(`  0x${idx.toString(16)}: ❌ NOT PATCHED (still uses remote API)`)
    } else {
      console.log(`  0x${idx.toString(16)}: ⚠️  UNKNOWN STATE`)
      console.log(`    Y0=${hasLocalLLM} $6.post=${hasRemoteAPI} firstParty=${hasAuthGate}`)
    }
  }
}

function restoreBinary() {
  if (!existsSync(BACKUP_PATH)) {
    console.log('No backup found. Nothing to restore.')
    return
  }

  console.log('Restoring original binary...')
  copyFileSync(BACKUP_PATH, CLAUDE_BIN)
  try {
    execSync(`codesign --force --sign - "${CLAUDE_BIN}"`, { stdio: 'pipe' })
  } catch {}
  unlinkSync(BACKUP_PATH)
  console.log('Restored successfully. Backup removed.')
}

function analyzeBinary() {
  const data = readFileSync(CLAUDE_BIN)

  console.log('─── Binary Analysis (Source-Informed) ───\n')

  // Find Fa_ function
  const funcIndices = findAllOccurrences(data, FUNC_SIGNATURE)
  console.log(`Fa_ function signature: ${funcIndices.length} occurrence(s)`)

  for (let i = 0; i < funcIndices.length; i++) {
    const offset = funcIndices[i]
    console.log(`\n  #${i + 1} at offset 0x${offset.toString(16)}:`)

    // Validate
    const window = data.subarray(offset, Math.min(offset + 1000, data.length))
    for (const v of VALIDATORS) {
      const found = window.indexOf(v.pattern) !== -1
      console.log(`    ${found ? '✓' : '✗'} ${v.desc}`)
    }

    // Find boundary
    const bodyStart = offset + FUNC_SIGNATURE.length - 1
    const funcEnd = findFunctionEnd(data, bodyStart)
    if (funcEnd !== -1) {
      const funcLen = funcEnd - offset
      console.log(`    Function length: ${funcLen} bytes`)
      console.log(`    Length in range: ${funcLen >= EXPECTED_LEN_MIN && funcLen <= EXPECTED_LEN_MAX ? '✓' : '✗'}`)

      // Check if already patched
      const hasY0 = window.indexOf(Buffer.from('Y0(')) !== -1
      const hasAPI = window.indexOf(Buffer.from('$6.post')) !== -1
      console.log(`    Uses Y0 (local LLM): ${hasY0 ? 'YES (patched)' : 'NO (original)'}`)
      console.log(`    Uses $6.post (remote): ${hasAPI ? 'YES (original)' : 'NO (patched)'}`)
    } else {
      console.log(`    Function boundary: NOT FOUND`)
    }
  }

  // Check nearby wE7 (companion generation) — should use Y0/ZP
  const wE7Pattern = Buffer.from('querySource:"buddy_companion"', 'utf8')
  const wE7Indices = findAllOccurrences(data, wE7Pattern)
  console.log(`\nwE7 (companion generation, uses Y0/ZP): ${wE7Indices.length} occurrence(s)`)
  if (wE7Indices.length > 0) {
    for (const idx of wE7Indices) {
      const nearby = data.subarray(idx - 100, idx + 200).toString('utf8')
      const hasY0 = nearby.includes('Y0(')
      const hasZP = nearby.includes('ZP()')
      console.log(`  0x${idx.toString(16)}: Y0=${hasY0}, ZP=${hasZP} ${hasY0 && hasZP ? '✓ works with local API' : ''}`)
    }
  }

  // Check Y0/ZP availability
  const zpPattern = Buffer.from('model:ZP()', 'utf8')
  const zpIndices = findAllOccurrences(data, zpPattern)
  console.log(`\nZP() (haiku model) calls: ${zpIndices.length} occurrence(s)`)
}

// ═══════════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════════

function findAllOccurrences(buf, search) {
  const indices = []
  let offset = 0
  while (offset < buf.length) {
    const idx = buf.indexOf(search, offset)
    if (idx === -1) break
    indices.push(idx)
    offset = idx + 1
  }
  return indices
}

// ═══════════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════════

main()
