/**
 * dsh-preset-memory — memory storage layer.
 *
 * 抄自 dsh-memory-evolve（作者 csyangwen）的 lib/store.js，做隔离适配：
 * 数据目录独立（遮蔽会话专用），与普通会话的 evolve 完全隔离。
 *
 * Hermes-compatible persistent curated memory: plain-text files with `\n§\n`
 * entry delimiters, per-target character limits, a cross-process lock file,
 * atomic writes, and a drift guard that refuses full-file rewrites when the
 * on-disk content would not round-trip through the parser.
 *
 * Write semantics:
 *   - add: append-only, skips the drift guard, refuses a file that exists
 *     and reads as empty (would wipe history);
 *   - replace / remove: match by a short unique substring, enforce the drift
 *     guard, back up drifted files to `<file>.bak.<timestamp>` before refusing;
 *   - 待确认队列（SuggestionQueue）：key 轨等写入先进 JSONL 队列，用户确认后生效；
 *   - 归档（ArchiveStore）：低优先级记忆的冷存储，可移回主轨或删除。
 *
 * All operations are synchronous (files are tiny) and serialized through one
 * lock file per directory so multiple DSH processes or external editors
 * cannot interleave writes.
 *
 * Zero runtime dependencies (node:fs + node:crypto only).
 */

import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { extractEntryId, genEntryId, legacyIdFor, stripEntryId } from './entryid.js'

/** Entry delimiter, byte-compatible with Hermes MEMORY.md / USER.md. */
export const ENTRY_DELIMITER = '\n§\n'

/** A lock file older than this is considered abandoned (stale). */
const STALE_LOCK_MS = 10_000
/** How long to keep waiting for the lock before failing loud. */
const LOCK_TIMEOUT_MS = 5_000
/** Spin interval while waiting for the lock. */
const LOCK_RETRY_MS = 25

/**
 * Split raw file text into trimmed, non-empty entries.
 * @param {string} text - raw file content.
 * @returns {string[]} the entries.
 */
export function parseEntries(text) {
  return text
    .split(ENTRY_DELIMITER)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/** Serialize entries into canonical file text. */
export function serializeEntries(entries) {
  return entries.join(ENTRY_DELIMITER) + '\n'
}

/** Extract the `YYYY-MM-DD` date from an entry's stamp prefix; null when absent. */
export function extractEntryDate(entry) {
  const match = /^\[(\d{4}-\d{2}-\d{2})/.exec(stripEntryId(entry))
  return match ? match[1] : null
}

/** Branch-scope tag inside a KEY entry: `[2026-08-06] [branch:main,dev] 内容`. */
export const BRANCH_TAG_RE = /(?:^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*)?\[branch:([^\]]*)\]\s*/

/** Parse the branch scope of one KEY entry; null = "all branches". */
export function parseEntryBranches(entry) {
  const match = BRANCH_TAG_RE.exec(entry)
  if (match === null) return null
  const branches = match[1].split(',').map((b) => b.trim()).filter(Boolean)
  return branches.length > 0 ? branches : null
}

/** 「仅 DSH」标记 tag。 */
export const DSH_ONLY_TAG = '[dsh-only]'

/** 条目内 [dsh-only] 标记的正则。 */
export const DSH_ONLY_RE = /\[dsh-only\]\s*/

/** 判断一条记忆条目是否带「仅 DSH」标记。 */
export function parseEntryDshOnly(entry) {
  return DSH_ONLY_RE.test(String(entry ?? ''))
}

/** 「摘要」标记 tag 正则。 */
export const SUMMARY_TAG_RE = /\[summary:([^\]]*)\]/

const ENTRY_HEAD_RE = /^(?:\[id:[0-9a-f]{8}\]\s*)?(?:\[\d{4}-\d{2}-\d{2}(?: \d{1,2}:\d{2}(?::\d{2})?)?\]\s*|\[\d{1,2}:\d{2}(?::\d{2})?\]\s*)?(?:\[git [^\]]+\]\s*)*(?:\[branch:[^\]]*\]\s*)?(?:\[dsh-only\]\s*)?/

/** 解析一条记忆条目的摘要标签（只认头部位置的 [summary:…]）。 */
export function parseEntrySummary(entry) {
  const text = String(entry ?? '')
  const head = ENTRY_HEAD_RE.exec(text)
  if (head === null) return null
  const match = /^\[summary:([^\]]*)\]\s*/.exec(text.slice(head[0].length))
  return match ? match[1] : null
}

/** 从条目正文自动生成摘要（无显式 [summary:...] 时的兜底）。 */
export function autoSummary(entry, maxLen = 80) {
  let rest = String(entry ?? '').trim()
  const head = ENTRY_HEAD_RE.exec(rest)
  if (head !== null) rest = rest.slice(head[0].length)
  rest = rest.replace(/^\[summary:[^\]]*\]\s*/, '')
  const firstLine = rest.split('\n')[0].trim()
  if (firstLine.length <= maxLen) return firstLine
  return firstLine.slice(0, maxLen - 1) + '…'
}

/** 展示剥离「摘要」标记（只剥头部位置的 summary tag）。 */
export function stripEntrySummary(entry) {
  const match = ENTRY_HEAD_RE.exec(String(entry ?? ''))
  const prefix = match === null ? '' : match[0]
  const rest = String(entry ?? '').slice(prefix.length)
  return prefix + rest.replace(/^\[summary:[^\]]*\]\s*/, '')
}

/**
 * 剥离一条目的全部前缀标记，返回前缀 head 与正文 body。
 * 编辑条目时用 head + 新正文重写，程序维护的元数据不可被编辑改动。
 */
export function splitEntryHead(entry, target) {
  let rest = String(entry ?? '').trim()
  const timeRe = target === 'project' ? /^\[(\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(?::\d{2})?)\]\s*/
    : target === 'daily' ? /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/
      : /^\[(\d{4}-\d{2}-\d{2})\]\s*/
  const tokens = []
  const idMatch = /^\[id:([0-9a-f]{8})\]\s*/.exec(rest)
  if (idMatch !== null) {
    tokens.push(idMatch[0])
    rest = rest.slice(idMatch[0].length)
  }
  const timeMatch = timeRe.exec(rest)
  if (timeMatch !== null) {
    tokens.push(timeMatch[0])
    rest = rest.slice(timeMatch[0].length)
  }
  for (;;) {
    const gitMatch = /^\[git ([^\]]+)\]\s*/.exec(rest)
    if (gitMatch === null) break
    tokens.push(gitMatch[0])
    rest = rest.slice(gitMatch[0].length)
  }
  const branchMatch = /^\[branch:[^\]]*\]\s*/.exec(rest)
  if (branchMatch !== null) {
    tokens.push(branchMatch[0])
    rest = rest.slice(branchMatch[0].length)
  }
  const dshOnlyMatch = /^\[dsh-only\]\s*/.exec(rest)
  if (dshOnlyMatch !== null) {
    tokens.push(dshOnlyMatch[0])
    rest = rest.slice(dshOnlyMatch[0].length)
  }
  const summaryMatch = /^\[summary:[^\]]*\]\s*/.exec(rest)
  if (summaryMatch !== null) {
    tokens.push(summaryMatch[0])
    rest = rest.slice(summaryMatch[0].length)
  }
  if (target === 'daily') {
    const tagMatch = /^\[([^\]]+)\]\s*/.exec(rest)
    if (tagMatch !== null) {
      tokens.push(tagMatch[0])
      rest = rest.slice(tagMatch[0].length)
    }
  }
  return { head: tokens.join(''), body: rest }
}

/** 匹配用归一化：剥展示层不显示的程序元数据（[id:…] / [summary:…]）。 */
export function normalizeForMatch(entry) {
  return stripEntrySummary(stripEntryId(String(entry ?? '')))
}

/** 精确匹配索引（对展示层剥离的程序元数据免疫）。 */
function findExactIndex(entries, exact, { first = false } = {}) {
  const target = normalizeForMatch(exact)
  let found = -1
  for (let i = 0; i < entries.length; i++) {
    if (normalizeForMatch(entries[i]) === target) {
      if (found !== -1 && !first) return -1
      if (found === -1) found = i
    }
  }
  return found
}

/** Whether raw text is the canonical serialization of its own entries. */
export function isCanonical(text) {
  return text.trim() === '' || serializeEntries(parseEntries(text)) === text
}

/** Blocking sleep used by the lock retry loop. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Directories whose lock this process currently holds (reentrancy guard). */
const heldLocks = new Set()

const LOCK_JSON = () => JSON.stringify({ pid: process.pid, at: Date.now() })

/**
 * stale 锁判断：mtime 超时，或锁文件里的 pid 已不存活。
 */
export function isStaleLock(lockPath) {
  try {
    const info = statSync(lockPath)
    try {
      const owner = JSON.parse(readFileSync(lockPath, 'utf8'))
      if (typeof owner.pid === 'number') {
        try {
          process.kill(owner.pid, 0)
          return false
        } catch {
          return true
        }
      }
    } catch {
      // 旧格式锁 → 按 mtime 判断
    }
    return Date.now() - info.mtimeMs > STALE_LOCK_MS
  } catch {
    return false
  }
}

/**
 * Acquire the directory lock exclusively (cross-process), run `fn`, release.
 */
export function withLock(dir, fn) {
  if (heldLocks.has(dir)) return fn()
  const lockPath = join(dir, '.memory.lock')
  mkdirSync(dir, { recursive: true })
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    let acquired = false
    try {
      const fd = openSync(lockPath, 'wx')
      try {
        writeFileSync(lockPath, LOCK_JSON())
      } finally {
        closeSync(fd)
      }
      acquired = true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    if (acquired) break
    if (isStaleLock(lockPath)) rmSync(lockPath, { force: true })
    if (Date.now() >= deadline) {
      throw new Error('dsh-preset-memory: timed out waiting for the memory lock')
    }
    sleep(LOCK_RETRY_MS)
  }
  heldLocks.add(dir)
  try {
    return fn()
  } finally {
    heldLocks.delete(dir)
    rmSync(lockPath, { force: true })
  }
}

/** Minimal prompt-injection scan applied to tool-written memory content. */
const THREAT_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|earlier|above|your)\s+(instructions?|prompts?|messages?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|earlier|above|your)\s+(instructions?|prompts?|messages?|rules?)/i,
  /forget\s+(all|everything|your\s+instructions)/i,
  /忽略(所有|之前|以上|先前)(的)?(指令|指示|提示|规则)/,
  /无视(所有|之前|以上|先前)(的)?(指令|指示|提示|规则)/,
]

/** Scan one memory entry for prompt-injection phrasing. */
export function scanThreat(text) {
  for (const pattern of THREAT_PATTERNS) {
    if (pattern.test(text)) {
      return '内容包含疑似提示注入的表述（如"忽略指令"），已拒绝写入。若确为有意内容，请直接编辑记忆文件。'
    }
  }
  return undefined
}

/** Today's date as `YYYY-MM-DD` (local time). */
export function todayStamp() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Stable 12-hex project key for one working directory. */
export function projectHash(cwd) {
  return createHash('sha1').update(cwd).digest('hex').slice(0, 12)
}

/** A short, stable project label for one working directory. */
export function projectLabel(cwd) {
  if (!cwd) return undefined
  const parts = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts.length === 0) return '/'
  const base = parts[parts.length - 1]
  if (base.length < 3 || /^\d+$/.test(base)) {
    return parts.length > 1 ? parts.slice(-2).join('/') : base
  }
  return base
}

/** Resolve the current git branch of a working directory. */
export function gitBranch(cwd) {
  if (!cwd) return undefined
  try {
    const result = spawnSync('git', ['branch', '--show-current'], {
      cwd, encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (result.error || result.status !== 0) return undefined
    const branch = String(result.stdout ?? '').trim()
    return branch === '' ? undefined : branch
  } catch {
    return undefined
  }
}

/** List all local branch names of a working directory. */
export function gitBranchList(cwd) {
  if (!cwd) return []
  try {
    const result = spawnSync('git', ['branch', '--format=%(refname:short)'], {
      cwd, encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (result.error || result.status !== 0) return []
    return String(result.stdout ?? '')
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => b.length > 0)
  } catch {
    return []
  }
}

/**
 * Persistent curated memory store over the five tracks: global facts
 * (memory.md / user.md), the daily log (daily/YYYY-MM-DD.md), the per-project
 * log (projects/<hash>/memory.md, keyed by the session cwd) and per-project
 * KEY facts (projects/<hash>/key.md).
 *
 * 数据文件命名与 evolve 一致（memory.md / user.md / daily/ / projects/），
 * 便于未来与 evolve 双向迁移；但数据目录独立（遮蔽会话专用，隔离）。
 */
export class MemoryStore {
  /**
   * @param {string} dir - the memory directory (created on demand).
   * @param {object} [options]
   * @param {boolean} [options.injectionScan=true] - enable the threat scan.
   * @param {boolean} [options.entryDatePrefix=true] - stamp entries with a
   *   `[YYYY-MM-DD] ` prefix on add.
   * @param {'off'|'on'} [options.entryIdMode='off'] - 条目身份证开关。
   */
  constructor(dir, options = {}) {
    this.dir = dir
    this.injectionScan = options.injectionScan ?? true
    this.entryDatePrefix = options.entryDatePrefix ?? true
    this.entryIdMode = options.entryIdMode === 'on' ? 'on' : 'off'
  }

  /**
   * Resolve one target to its file location.
   * @param {string} target - 'memory' | 'user' | 'daily' | 'project' | 'key'.
   * @param {object | undefined} agent - required for 'project' and 'key'.
   */
  locate(target, agent) {
    switch (target) {
      case 'memory':
        return { dir: this.dir, file: 'memory.md' }
      case 'user':
        return { dir: this.dir, file: 'user.md' }
      case 'daily':
        return { dir: join(this.dir, 'daily'), file: `${todayStamp()}.md` }
      case 'key':
        // lite 模式：preset 级全局关键事实（根目录 key.md，无需 cwd）
        if (this.entryIdMode !== 'on') return { dir: this.dir, file: 'key.md' }
        // full 模式：项目隔离（对齐 evolve projects/<hash>/KEY.md）
        {
          const cwd = agent?.session?.header?.cwd
          if (!cwd) return undefined
          return { dir: join(this.dir, 'projects', projectHash(cwd)), file: 'key.md' }
        }
      case 'project': {
        const cwd = agent?.session?.header?.cwd
        if (!cwd) return undefined
        return { dir: join(this.dir, 'projects', projectHash(cwd)), file: 'memory.md' }
      }
      default:
        throw new Error(`dsh-preset-memory: 无效的记忆轨 "${target}"`)
    }
  }

  /** Resolve a target or fail loud. */
  resolveTarget(target, agent) {
    const loc = this.locate(target, agent)
    if (!loc) {
      throw new Error(`dsh-preset-memory: 无法定位记忆轨 "${target}"（项目记忆需要有效的会话工作目录）`)
    }
    return loc
  }

  /**
   * Stamp one entry with a time prefix. Idempotent for content that already
   * carries the matching prefix.
   */
  stampEntry(target, content, agent) {
    const entryId = extractEntryId(content)
    if (entryId !== null) content = stripEntryId(content)
    let stamped
    if (target === 'daily' || target === 'project' || target === 'key') {
      content = content.replace(/^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*/, '')
      content = content.replace(/^\[git [^\]]+\]\s*/, '')
    }
    if (target === 'daily') {
      if (!this.entryDatePrefix || /^\[\d{2}:\d{2}\]\s/.test(content)) {
        stamped = content
      } else {
        const d = new Date()
        const hh = String(d.getHours()).padStart(2, '0')
        const mm = String(d.getMinutes()).padStart(2, '0')
        const label = projectLabel(agent?.session?.header?.cwd)
        const branch = gitBranch(agent?.session?.header?.cwd)
        const branchTag = branch !== undefined ? `[git ${branch}] ` : ''
        stamped = `[${hh}:${mm}] ${branchTag}${label ? `[${label}] ` : ''}${content}`
      }
    } else if (target === 'project') {
      if (!this.entryDatePrefix || /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]\s/.test(content)) {
        stamped = content
      } else {
        const d = new Date()
        const hh = String(d.getHours()).padStart(2, '0')
        const mm = String(d.getMinutes()).padStart(2, '0')
        const branch = gitBranch(agent?.session?.header?.cwd)
        const branchTag = branch !== undefined ? `[git ${branch}] ` : ''
        stamped = `[${todayStamp()} ${hh}:${mm}] ${branchTag}${content}`
      }
    } else if (!this.entryDatePrefix || /^\[\d{4}-\d{2}-\d{2}\]\s/.test(content)) {
      stamped = content
    } else {
      stamped = `[${todayStamp()}] ${content}`
    }
    if (entryId !== null) stamped = `[id:${entryId}] ${stamped}`
    return stamped
  }

  /** Absolute path of one target's file. */
  pathOf(target, agent) {
    const loc = this.resolveTarget(target, agent)
    return join(loc.dir, loc.file)
  }

  /** Current character usage of one target. */
  charsOf(target, agent) {
    return this.entriesOf(target, agent).join(ENTRY_DELIMITER).length
  }

  /** Read one target's entries without locking (snapshot reads). */
  entriesOf(target, agent) {
    return parseEntries(this.readRaw(target, agent).text)
  }

  /**
   * Query entries with LLM-friendly lookups.
   */
  query(target, agent, opts = {}, stats = {}) {
    const { filter, since, until, limit, recent } = opts
    let rows = []
    if (target === 'daily' && (since !== undefined || until !== undefined)) {
      const dir = join(this.dir, 'daily')
      let days = []
      try {
        days = readdirSync(dir)
          .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
          .map((name) => name.slice(0, 10))
          .sort()
      } catch {
        days = []
      }
      for (const day of days) {
        if ((since !== undefined && day < since) || (until !== undefined && day > until)) continue
        let text
        try {
          text = readFileSync(join(dir, `${day}.md`), 'utf8')
        } catch {
          continue
        }
        for (const entry of parseEntries(text)) rows.push({ date: day, text: entry })
      }
    } else {
      const fileDate = target === 'daily' ? todayStamp() : null
      for (const entry of this.entriesOf(target, agent)) {
        rows.push({ date: fileDate ?? extractEntryDate(entry), text: entry })
      }
    }
    if (filter !== undefined && String(filter) !== '') {
      const q = String(filter).toLowerCase()
      rows = rows.filter((row) => row.text.toLowerCase().includes(q))
    }
    if (since !== undefined || until !== undefined) {
      rows = rows.filter((row) => {
        if (row.date === null) return true
        if (since !== undefined && row.date < since) return false
        if (until !== undefined && row.date > until) return false
        return true
      })
    }
    stats.undated = rows.filter((row) => row.date === null).length
    stats.total = rows.length
    if (recent) rows.reverse()
    if (limit !== undefined && Number.isFinite(Number(limit)) && Number(limit) > 0) {
      rows = rows.slice(0, Math.floor(Number(limit)))
    }
    return rows.map((row) => row.text)
  }

  /** Read the raw file; a missing file reads as an empty store. */
  readRaw(target, agent) {
    const path = this.pathOf(target, agent)
    try {
      return { text: readFileSync(path, 'utf8'), size: statSync(path).size }
    } catch (error) {
      if (error.code === 'ENOENT') return { text: '', size: 0 }
      throw error
    }
  }

  /** Reload one target under the caller's lock (with drift guard). */
  reload(target, agent) {
    const { text, size } = this.readRaw(target, agent)
    if (text === '' && size > 0) return { kind: 'read-failed' }
    if (!isCanonical(text)) {
      const backup = `${this.pathOf(target, agent)}.bak.${Date.now()}`
      writeFileSync(backup, text)
      return { kind: 'drift', backup }
    }
    return { kind: 'ok', entries: parseEntries(text) }
  }

  /** Atomically write entries to one target's file. */
  write(target, entries, agent) {
    const path = this.pathOf(target, agent)
    const tmp = `${path}.tmp.${process.pid}`
    writeFileSync(tmp, serializeEntries(entries))
    renameSync(tmp, path)
  }

  /** Reload for append (skips the drift guard). */
  reloadForAppend(target, agent) {
    const { text, size } = this.readRaw(target, agent)
    if (text === '' && size > 0) return { kind: 'read-failed' }
    return { kind: 'ok', entries: parseEntries(text) }
  }

  /**
   * Append one entry. Skips the drift guard, rejects empty content, exact
   * duplicates, over-limit additions, and unreadable files.
   */
  add(target, content, agent) {
    const loc = this.resolveTarget(target, agent)
    const text = String(content).trim()
    if (!text) return { ok: false, message: '内容为空，拒绝写入', target }
    if (this.injectionScan) {
      const threat = scanThreat(text)
      if (threat) return { ok: false, message: threat, target }
    }
    const stamped = this.stampEntry(target, text, agent)
    return withLock(loc.dir, () => {
      const reload = this.reloadForAppend(target, agent)
      if (reload.kind === 'read-failed') {
        return { ok: false, message: '文件存在但读不出内容（疑似编码损坏），已拒绝写入（防止清空历史）', target }
      }
      const entries = reload.entries
      const syncedTrack = this.entryIdMode === 'on' && (target === 'key' || target === 'project')
      const withId = syncedTrack && !/^\[id:[0-9a-f]{8}\]\s*/.test(stamped)
        ? `[id:${genEntryId()}] ${stamped}`
        : stamped
      const dupKey = (entry) => String(entry)
        .replace(/^\[id:[0-9a-f]{8}\]\s*/, '')
        .replace(/^\[\d{2}:\d{2}\]\s*/, '')
        .replace(/^\[(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}\]\s*/, '[$1] ')
        .replace(/^\[git [^\]]+\]\s*/, '')
        .trim()
      const dup = syncedTrack
        ? entries.some((entry) => stripEntryId(entry) === stripEntryId(withId))
        : entries.some((entry) => dupKey(entry) === dupKey(withId))
      if (dup) {
        return {
          ok: true, duplicate: true, message: '与已有记忆重复，未写入', target,
          entries: [...entries], chars: this.charsOf(target, agent),
        }
      }
      const next = [...entries, withId]
      this.write(target, next, agent)
      return {
        ok: true, message: `已写入 ${target} 轨：条目数 ${entries.length} → ${next.length}`, target,
        entries: [...next], chars: next.join(ENTRY_DELIMITER).length,
      }
    })
  }

  /**
   * Replace the whole entry containing the unique substring `match`.
   * Enforces the drift guard (full-file rewrite).
   */
  replace(target, match, content, agent) {
    const loc = this.resolveTarget(target, agent)
    const oldText = String(match ?? '').trim()
    const newContent = String(content ?? '').trim()
    if (!oldText) return { ok: false, message: '匹配内容为空', target }
    if (!newContent) return { ok: false, message: '新内容为空', target }
    if (this.injectionScan) {
      const threat = scanThreat(newContent)
      if (threat) return { ok: false, message: threat, target }
    }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return { ok: false, message: `文件格式已损坏（无法往返解析），已备份到 ${reload.backup}，拒绝写入`, target, backup: reload.backup }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: '文件存在但读不出内容（疑似编码损坏），拒绝写入', target }
      }
      const entries = reload.entries
      const matches = entries.filter((entry) => entry.includes(oldText))
      if (matches.length === 0) {
        return { ok: false, message: `没有找到包含「${oldText}」的条目`, target, entries: [...entries] }
      }
      if (matches.length > 1) {
        return { ok: false, message: `「${oldText}」命中 ${matches.length} 条，无法确定是哪一条`, target, matches: [...matches], entries: [...entries] }
      }
      const index = entries.indexOf(matches[0])
      const next = [...entries]
      let replacement = this.stampEntry(target, newContent, agent)
      const oldId = extractEntryId(matches[0])
      if (this.entryIdMode === 'on' && oldId !== null) {
        replacement = stripEntryId(replacement)
        replacement = `[id:${oldId}] ${replacement}`
      } else if (this.entryIdMode === 'on' && (target === 'key' || target === 'project')) {
        const legacyId = legacyIdFor(stripEntryId(matches[0]))
        replacement = stripEntryId(replacement)
        replacement = `[id:${legacyId}] ${replacement}`
      }
      next[index] = replacement
      this.write(target, next, agent)
      return { ok: true, message: `已替换 ${target} 轨条目（共 ${entries.length} 条）`, target, entries: [...next], chars: next.join(ENTRY_DELIMITER).length }
    })
  }

  /**
   * Remove the entry containing the unique substring `match`.
   * Enforces the drift guard (full-file rewrite).
   */
  remove(target, match, agent) {
    const loc = this.resolveTarget(target, agent)
    const oldText = String(match ?? '').trim()
    if (!oldText) return { ok: false, message: '匹配内容为空', target }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return { ok: false, message: `文件格式已损坏（无法往返解析），已备份到 ${reload.backup}，拒绝操作`, target, backup: reload.backup }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: '文件存在但读不出内容（疑似编码损坏），拒绝写入', target }
      }
      const entries = reload.entries
      const matches = entries.filter((entry) => entry.includes(oldText))
      if (matches.length === 0) {
        return { ok: false, message: `没有找到包含「${oldText}」的条目`, target, entries: [...entries] }
      }
      if (matches.length > 1) {
        return { ok: false, message: `「${oldText}」命中 ${matches.length} 条，无法确定是哪一条`, target, matches: [...matches], entries: [...entries] }
      }
      const index = entries.indexOf(matches[0])
      const next = [...entries]
      next.splice(index, 1)
      this.write(target, next, agent)
      return { ok: true, message: `已删除 ${target} 轨条目：${entries.length} → ${next.length}`, target, removed: matches[0], entries: [...next], chars: next.join(ENTRY_DELIMITER).length }
    })
  }

  /**
   * Preview the single entry containing the unique substring `match`,
   * WITHOUT writing anything.
   */
  peek(target, match, agent) {
    const loc = this.resolveTarget(target, agent)
    const oldText = String(match ?? '').trim()
    if (!oldText) return { ok: false, message: '匹配内容为空', target }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return { ok: false, message: `文件格式已损坏（无法往返解析），已备份到 ${reload.backup}，拒绝操作`, target, backup: reload.backup }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: '文件存在但读不出内容（疑似编码损坏），拒绝操作', target }
      }
      const matches = reload.entries.filter((entry) => entry.includes(oldText))
      if (matches.length === 0) {
        return { ok: false, message: `没有找到包含「${oldText}」的条目`, target }
      }
      if (matches.length > 1) {
        return { ok: false, message: `「${oldText}」命中 ${matches.length} 条，无法确定是哪一条`, target }
      }
      return { ok: true, entry: matches[0], target }
    })
  }

  /**
   * Preview whether an EXACT whole-entry match exists (read-only).
   * Returns the on-disk original, not the caller's text.
   */
  peekExact(target, entry, agent) {
    const loc = this.resolveTarget(target, agent)
    const exact = String(entry ?? '').trim()
    if (!exact) return { ok: false, message: '条目内容为空', target }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return { ok: false, message: `文件格式已损坏（无法往返解析），已备份到 ${reload.backup}，拒绝操作`, target, backup: reload.backup }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: '文件存在但读不出内容（疑似编码损坏），拒绝操作', target }
      }
      const index = findExactIndex(reload.entries, exact)
      if (index === -1) {
        return { ok: false, message: '主记忆轨中没有这条条目', target }
      }
      return { ok: true, entry: reload.entries[index], target }
    })
  }

  /**
   * Remove the entry that EXACTLY equals `entry` (whole-entry match).
   * Used by the memory tab's per-entry delete button.
   */
  removeExact(target, entry, agent) {
    const loc = this.resolveTarget(target, agent)
    const exact = String(entry ?? '').trim()
    if (!exact) return { ok: false, message: '条目内容为空', target }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return { ok: false, message: `文件格式已损坏（无法往返解析），已备份到 ${reload.backup}，拒绝操作`, target, backup: reload.backup }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: '文件存在但读不出内容（疑似编码损坏），拒绝写入', target }
      }
      const entries = reload.entries
      const index = findExactIndex(entries, exact)
      if (index === -1) {
        return { ok: false, message: '没有找到这条条目', target, entries: [...entries] }
      }
      const next = [...entries]
      next.splice(index, 1)
      this.write(target, next, agent)
      return { ok: true, message: `已删除 ${target} 轨条目：${entries.length} → ${next.length}`, target, entries: [...next], chars: next.join(ENTRY_DELIMITER).length }
    })
  }

  /**
   * 只更新一条目的正文（整条精确匹配）。时间戳与全部 tag 原样保留。
   * 内容禁止包含条目分隔符 §。
   */
  updateEntryContent(target, entry, content, agent) {
    const loc = this.resolveTarget(target, agent)
    const exact = String(entry ?? '').trim()
    const newContent = String(content ?? '').trim()
    if (!exact) return { ok: false, message: '条目内容为空', target }
    if (!newContent) return { ok: false, message: '新内容为空（想删除请用删除操作）', target }
    if (newContent.includes('§')) {
      return { ok: false, message: '内容不能包含分隔符 §', target }
    }
    if (this.injectionScan) {
      const threat = scanThreat(newContent)
      if (threat) return { ok: false, message: threat, target }
    }
    return withLock(loc.dir, () => {
      const reload = this.reload(target, agent)
      if (reload.kind === 'drift') {
        return { ok: false, message: `文件格式已损坏（无法往返解析），已备份到 ${reload.backup}，拒绝写入`, target, backup: reload.backup }
      }
      if (reload.kind === 'read-failed') {
        return { ok: false, message: '文件存在但读不出内容（疑似编码损坏），拒绝写入', target }
      }
      const entries = reload.entries
      const index = findExactIndex(entries, exact)
      if (index === -1) {
        return { ok: false, message: '没有找到这条条目', target, entries: [...entries] }
      }
      const { head } = splitEntryHead(entries[index], target)
      if (head === '') {
        return { ok: false, message: '该条目头部无法解析，编辑会破坏格式——请手动处理', target, entries: [...entries] }
      }
      const next = [...entries]
      next[index] = `${head}${newContent}`
      this.write(target, next, agent)
      return { ok: true, message: `已更新 ${target} 轨条目`, target, entries: [...next], chars: next.join(ENTRY_DELIMITER).length }
    })
  }
}

/**
 * Append-only JSONL queue of background-review memory suggestions
 * (the "learned track" awaiting user confirmation).
 */
export class SuggestionQueue {
  /**
   * @param {string} file - the JSONL file path.
   */
  constructor(file) {
    this.file = file
  }

  /** Read all suggestions; a missing file reads as empty. */
  read() {
    try {
      const text = readFileSync(this.file, 'utf8')
      return text
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line))
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  /** Atomically write the full suggestion list. */
  write(entries) {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp.${process.pid}`
    writeFileSync(tmp, entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length > 0 ? '\n' : ''))
    renameSync(tmp, this.file)
  }

  /** Append one suggestion under the directory lock. */
  append(entry) {
    return withLock(dirname(this.file), () => {
      const entries = this.read()
      entries.push(entry)
      this.write(entries)
      return { ok: true, queued: entries.length }
    })
  }

  /** Mutate the suggestion list under the directory lock. */
  mutate(fn) {
    return withLock(dirname(this.file), () => {
      const entries = this.read()
      const result = fn(entries)
      this.write(entries)
      return result
    })
  }
}

/**
 * 归档存储：低优先级记忆的冷存储。不注入任何会话；条目可在记忆面板
 * 「移回主记忆」（转正，写回对应主轨）或删除。文件与主轨同格式。
 */
export class ArchiveStore {
  /**
   * @param {string} dir - the memory directory.
   */
  constructor(dir) {
    this.dir = dir
  }

  /** Resolve one archive file path; key requires the project cwd. */
  fileOf(target, cwd) {
    if (target === 'memory') return join(this.dir, 'memory-archive.md')
    if (target === 'user') return join(this.dir, 'user-archive.md')
    if (target === 'key') {
      if (!cwd) throw new Error('dsh-preset-memory: key 归档需要会话工作目录')
      return join(this.dir, 'projects', projectHash(cwd), 'key-archive.md')
    }
    if (typeof target === 'string' && target.startsWith('todo-')) {
      return join(this.dir, 'todo-archive.md')
    }
    throw new Error(`dsh-preset-memory: 无效的归档轨 "${target}"`)
  }

  /** Read one archive track's entries; a missing file reads as empty. */
  entriesOf(target, cwd) {
    try {
      return parseEntries(readFileSync(this.fileOf(target, cwd), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  /** Append one entry under the directory lock (atomic write). */
  append(target, content, cwd) {
    const lockDir = dirname(this.fileOf(target, cwd))
    return withLock(lockDir, () => {
      const entries = this.entriesOf(target, cwd)
      entries.push(content)
      const path = this.fileOf(target, cwd)
      const tmp = `${path}.tmp.${process.pid}`
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(tmp, serializeEntries(entries))
      renameSync(tmp, path)
      return { ok: true, total: entries.length }
    })
  }

  /** Remove the entry that EXACTLY equals `content` (whole-entry match). */
  removeExact(target, content, cwd) {
    return withLock(this.dir, () => {
      const entries = this.entriesOf(target, cwd)
      const index = findExactIndex(entries, content, { first: true })
      if (index === -1) {
        return { ok: false, message: '归档中没有这条条目' }
      }
      const next = [...entries]
      next.splice(index, 1)
      const path = this.fileOf(target, cwd)
      const tmp = `${path}.tmp.${process.pid}`
      writeFileSync(tmp, serializeEntries(next))
      renameSync(tmp, path)
      return { ok: true, removed: entries[index] }
    })
  }
}
