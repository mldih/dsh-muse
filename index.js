/**
 * @deepseek-ai/dsh-muse —— 宿主半边（v2 全栈）。
 *
 * 目标（相对 v1）：
 *   · 不再绑定 DSHM：首次启用自动探测宿主（DSHM / dsh / 通用），在应用专属目录
 *     建立固定记忆库，并把探测结果写进 host.json，之后始终复用；
 *   · 记忆库容量默认 1 GB、可由用户改成任意值（0 = 不限）；超限自动压缩/归档/删除；
 *   · 人格设置（名字/语气/讲解风格/自定义提示词）经 systemPrompt 注入**每一次模型调用**；
 *   · llm/stream 钩子包装全部模型流，强制接入并采集思考（reasoning）与正文；
 *   · 会话事件持续更新画像证据；
 *   · 对面板开放本地 HTTP API（受同源 + 环回 + 自定义头约束），供右侧栏读写。
 *
 * 不虚标：
 *   · 没有 webServer 服务时面板走只读回退；
 *   · 没有 sessionPersistence 时 collect 如实报错；
 *   · 网络失败时文献核验如实报告，不返回假条目；
 *   · 流钩子只**旁路采集**，永不缓存/改写模型输出，采集失败不影响模型。
 */
import { mkdir, readFile, writeFile, appendFile, rename, stat, readdir, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-muse'
export const inject = ['tools']

const DEFAULT_CAP_BYTES = 1024 * 1024 * 1024 // 1 GB
const MAX_FILE_BYTES = 102400
const UNKNOWN_THRESHOLD = 3
const CAPTURE_ROTATE_BYTES = 8 * 1024 * 1024
const CAPTURE_KEEP_FILES = 2

const FILES = {
  host: 'host.json',
  limits: 'limits.json',
  profile: 'profile.json',
  persona: 'persona.json',
  plan: 'plan.json',
  ledger: 'ledger.json',
  literature: 'literature.json',
  notes: 'notes.md',
  draft: 'draft.md',
  overview: 'overview.md',
  conversations: 'conversations.log',
  compaction: 'compaction-report.json',
}

/** 用户/模型新建的记忆条目目录（与核心文件分开，只在这里展示）。 */
const MEMORIES_DIR = 'memories'

const TRI = ['done', 'missing', 'unknown']
const TRI_LABEL = { done: '已完成', missing: '明确缺失', unknown: '状态未知' }

const BLOCKER_LIBRARY = {
  seed_missing: { label: '随机种子未记录', probe: ['实验脚本是否固定了 torch/numpy/random 的 seed，写在哪一行？', '同一份代码连续跑两次，指标是否逐位一致？'], concept: 'reproducibility' },
  split_unknown: { label: '数据划分方式未知', probe: ['训练/验证/测试按样本、时间还是分组划分？', '划分比例与随机种子在哪个文件哪一行？'], concept: 'data_split' },
  hyperparam_range: { label: '超参搜索范围未披露', probe: ['学习率/批量大小/层数的候选区间是多少？', '最终取值依据验证集还是测试集？'], concept: 'hyperparameter_search' },
  dep_version: { label: '依赖版本未锁定', probe: ['requirements/environment 在哪，是否被 git 跟踪？', '框架与 CUDA 版本是否与作者环境一致？'], concept: 'environment' },
  ablation_config: { label: '消融实验配置不清', probe: ['每个消融变体是否只改了一个因素？', '去掉模块后是否同步调整训练步数/参数量？'], concept: 'ablation_study' },
  concept_unclear: { label: '概念尚未理解', probe: ['能用自己的话说出这个概念解决什么问题吗？', '它在材料哪一节/哪个公式首次出现？'], concept: null },
  not_started: { label: '事项尚未启动', probe: ['这周能先完成的最小一步是什么？', '当前卡在环境、数据还是时间？'], concept: null },
  summary_only: { label: '精读停留在摘要层', probe: ['你读到方法/实验哪一节了？', '能否复述论文核心图表的结论？'], concept: null },
}

const CONCEPT_PATHS = {
  reproducibility: '先读「可复现性 checklist」一页 → 在脚本头部固定 3 个 seed 跑两遍 → 对比指标是否逐位一致。',
  data_split: '先弄清按样本/时间/分组三种划分的差别 → 画出数据划分示意图 → 标注比例与种子位置。',
  hyperparameter_search: '先看网格/随机/贝叶斯三种搜索的区别 → 写下实际搜过的区间 → 说明选值依据。',
  environment: '先导出 pip freeze → 标出框架与 CUDA 版本 → 与作者仓库对比差异。',
  ablation_study: '先看一篇论文的消融章节 → 最小代码只去掉一个模块跑 2 组对照 → 记录指标差并解释。',
}

const CONCEPT_LEVEL_LABEL = { 0: '未接触', 1: '听过', 2: '能复述', 3: '能应用' }

const DEFAULT_PROFILE = { version: 1, updatedAt: null, level: 'unknown', interests: [], concepts: {}, learningStyle: [], summary: '', evidence: [], captures: 0, reasoningChars: 0 }
const DEFAULT_PERSONA = { version: 1, updatedAt: null, name: 'Muse', tone: '温和严谨', depth: '跟随画像', language: '中文', style: '先给结论与框架，再展开关键步骤；术语首次出现时附一句解释。', custom: '', showThinking: false }
const DEFAULT_LIMITS = { version: 1, updatedAt: null, maxBytes: DEFAULT_CAP_BYTES, autoCompact: true }

// ---------------------------------------------------------------------------
// 宿主探测 + 固定记忆库
// ---------------------------------------------------------------------------
function envString(key) {
  const value = process.env[key]
  return typeof value === 'string' ? value.trim() : ''
}

function candidateHomes() {
  const out = []
  const explicit = envString('MUSE_HOME')
  if (explicit) return [{ app: 'explicit', dir: explicit }]
  const dshHome = envString('DSH_HOME')
  const dshmHome = envString('DSHM_HOME')
  const publicDownload = envString('DSHM_PUBLIC_DOWNLOAD')
  const xdg = envString('XDG_DATA_HOME')
  const home = envString('HOME')
  if (dshHome) out.push({ app: 'dsh', dir: join(dshHome, 'muse') })
  if (dshmHome) out.push({ app: 'dsh', dir: join(dshmHome, 'muse') })
  if (publicDownload) out.push({ app: 'dsh', dir: join(publicDownload, '.muse') })
  if (xdg) out.push({ app: 'dsh', dir: join(xdg, 'muse') })
  if (home) out.push({ app: 'dsh', dir: join(home, '.local', 'share', 'muse') })
  out.push({ app: 'dsh', dir: join(process.cwd(), '.muse') })
  return out
}

async function writableDir(dir) {
  try {
    await mkdir(dir, { recursive: true })
    const probe = join(dir, '.probe-' + randomUUID())
    await writeFile(probe, 'ok')
    await unlink(probe)
    return true
  } catch {
    return false
  }
}

/** 固定记忆库目录：优先复用已有 host.json 的目录，否则在第一个可写候选处建立。 */
let cachedMemoryDir = null

async function memoryHome() {
  if (cachedMemoryDir) return cachedMemoryDir
  const candidates = candidateHomes()
  for (const candidate of candidates) {
    try {
      const hostPath = join(candidate.dir, FILES.host)
      const existing = await readFile(hostPath, 'utf8')
      const parsed = JSON.parse(existing)
      if (parsed && typeof parsed.dir === 'string' && parsed.dir.length > 0) {
        cachedMemoryDir = { ...candidate, dir: candidate.dir, host: parsed }
        return cachedMemoryDir
      }
    } catch { /* 没有 host.json，继续找 */ }
  }
  for (const candidate of candidates) {
    if (await writableDir(candidate.dir)) {
      const host = {
        app: candidate.app,
        dir: candidate.dir,
        detectedAt: new Date().toISOString(),
        markers: Object.keys(process.env).filter(key => /^(DSH|DSHM|MUSE)/.test(key)).slice(0, 20),
        platform: process.platform,
        arch: process.arch,
        node: process.version,
      }
      await writeJson(join(candidate.dir, FILES.host), host)
      cachedMemoryDir = { ...candidate, host }
      return cachedMemoryDir
    }
  }
  throw new Error('Muse：找不到可写的记忆库目录（可用 MUSE_HOME 指定）')
}

function repoRootCache() { return cachedMemoryDir ? cachedMemoryDir.dir : join(process.cwd(), '.muse') }
function filePath(key) { return join(repoRootCache(), FILES[key]) }

// ---------------------------------------------------------------------------
// 基础文件工具
// ---------------------------------------------------------------------------
async function readText(path) {
  try { return await readFile(path, 'utf8') } catch (error) { if (error && error.code === 'ENOENT') return null; throw error }
}
async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = path + '.tmp-' + Date.now()
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, path)
  return Buffer.byteLength(text, 'utf8')
}
async function readJson(path, fallback) {
  const text = await readText(path)
  if (text === null) return fallback
  try { return JSON.parse(text) } catch { return fallback }
}
async function writeJson(path, value) { return writeText(path, JSON.stringify(value, null, 2)) }
function sizeOf(text) { return Buffer.byteLength(String(text || ''), 'utf8') }
function capText(text, max) { const s = String(text || '').trim(); return s.length <= max ? s : s.slice(0, max) + '\n…（已截断）' }
function nowIso() { return new Date().toISOString() }
function fmtTime(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso || '') : d.toLocaleString('zh-CN', { hour12: false }) }
function bullets(lines) { return lines.map(line => '- ' + line).join('\n') }

// ---------------------------------------------------------------------------
// 容量：默认 1GB，可调（0 = 不限），超限自动压缩
// ---------------------------------------------------------------------------
async function loadLimits() {
  const limits = await readJson(filePath('limits'), DEFAULT_LIMITS)
  return Object.assign({}, DEFAULT_LIMITS, limits)
}

async function usage() {
  const dir = repoRootCache()
  let bytes = 0
  const files = []
  async function walk(current, prefix, depth) {
    let entries = []
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const relative = prefix.length > 0 ? prefix + '/' + entry.name : entry.name
      if (entry.isDirectory()) {
        if (depth < 2) await walk(join(current, entry.name), relative, depth + 1)
        continue
      }
      try {
        const info = await stat(join(current, entry.name))
        bytes += info.size
        files.push({ name: relative, bytes: info.size, mtime: info.mtime.toISOString() })
      } catch { /* 忽略读不到的条目 */ }
    }
  }
  await walk(dir, '', 0)
  files.sort((a, b) => b.bytes - a.bytes)
  const limits = await loadLimits()
  return { dir, bytes, files, limits, percent: limits.maxBytes > 0 ? Math.min(999, Math.round(bytes * 1000 / limits.maxBytes) / 10) : 0 }
}

async function rotateCaptureLog() {
  const path = filePath('conversations')
  let current = 0
  try { current = (await stat(path)).size } catch { current = 0 }
  if (current < CAPTURE_ROTATE_BYTES) return
  for (let index = CAPTURE_KEEP_FILES; index >= 1; index -= 1) {
    const from = index === 1 ? path : path + '.' + (index - 1)
    const to = path + '.' + index
    try { await rename(from, to) } catch { /* 不存在则跳过 */ }
  }
}

async function compactMemory(reason) {
  const before = await usage()
  const limits = before.limits
  const report = { at: nowIso(), reason: reason || 'manual', beforeBytes: before.bytes, maxBytes: limits.maxBytes, actions: [], afterBytes: before.bytes }
  if (limits.maxBytes > 0 && before.bytes <= limits.maxBytes) {
    report.afterBytes = before.bytes
    await writeJson(filePath('compaction'), report)
    return report
  }
  const over = limits.maxBytes > 0 && before.bytes > limits.maxBytes

  // 1) 笔记 / 草稿截断（保留尾部）
  for (const [key, keep] of [['notes', 64 * 1024], ['draft', 128 * 1024], ['overview', 64 * 1024]]) {
    const text = await readText(filePath(key))
    if (text && sizeOf(text) > keep) {
      await writeText(filePath(key), '…（更早内容已压缩）\n' + text.slice(-keep))
      report.actions.push('截断 ' + FILES[key] + ' 到 ' + keep + ' bytes')
    }
  }

  // 1b) 记忆条目：单条超过 64KB 时保留尾部
  try {
    const memDir = memoriesRoot()
    const memEntries = await readdir(memDir, { withFileTypes: true })
    for (const entry of memEntries) {
      if (!entry.isFile()) continue
      const memPath = join(memDir, entry.name)
      const text = await readText(memPath)
      if (text && sizeOf(text) > 64 * 1024) {
        await writeText(memPath, '…（更早内容已压缩）\n' + text.slice(-64 * 1024))
        report.actions.push('截断记忆 ' + entry.name)
      }
    }
  } catch { /* 没有 memories 目录时跳过 */ }

  // 2) 台账：done 项归档
  const ledger = await readJson(filePath('ledger'), { version: 1, items: [] })
  const items = Array.isArray(ledger.items) ? ledger.items : []
  const archivePath = join(repoRootCache(), 'ledger_archive.json')
  const archive = await readJson(archivePath, { version: 1, items: [] })
  const done = items.filter(item => item.tri === 'done')
  if (done.length > 0) {
    archive.items = (Array.isArray(archive.items) ? archive.items : []).concat(done.map(item => ({ id: item.id, title: item.title, archivedAt: nowIso() }))).slice(-2000)
    ledger.items = items.filter(item => item.tri !== 'done')
    await writeJson(archivePath, archive)
    await writeJson(filePath('ledger'), ledger)
    report.actions.push('归档 ' + done.length + ' 条已完成台账')
  }

  // 3) 文献去重
  const literature = await readJson(filePath('literature'), { version: 1, items: [] })
  const refs = Array.isArray(literature.items) ? literature.items : []
  const seen = new Set()
  const kept = []
  for (const ref of refs) {
    const key = ref.doi || ref.pmid || ref.title
    if (!key || seen.has(key)) continue
    seen.add(key)
    kept.push(ref)
  }
  if (kept.length !== refs.length) {
    literature.items = kept
    await writeJson(filePath('literature'), literature)
    report.actions.push('去重文献 ' + (refs.length - kept.length) + ' 条')
  }

  // 4) 采集日志轮转 + 清理旧轮转
  await rotateCaptureLog()
  const dir = repoRootCache()
  try {
    const entries = await readdir(dir)
    for (const entry of entries) {
      if (/^conversations\.log\.(\d+)$/.test(entry) && Number(entry.split('.').pop()) > CAPTURE_KEEP_FILES) {
        await unlink(join(dir, entry))
        report.actions.push('删除过期采集 ' + entry)
      }
    }
  } catch { /* 忽略 */ }

  // 5) 仍超限：删除最大非核心归档文件（保留核心 JSON）
  let after = await usage()
  if (limits.maxBytes > 0 && after.bytes > limits.maxBytes) {
    const protectedNames = new Set(Object.values(FILES))
    const removable = after.files.filter(file => !protectedNames.has(file.name)).sort((a, b) => b.bytes - a.bytes)
    for (const file of removable) {
      if ((await usage()).bytes <= limits.maxBytes) break
      try {
        await unlink(join(dir, file.name))
        report.actions.push('删除超限文件 ' + file.name)
      } catch { /* 忽略 */ }
    }
  }

  after = await usage()
  report.afterBytes = after.bytes
  await writeJson(filePath('compaction'), report)
  return report
}

async function maybeCompact() {
  const current = await usage()
  const limits = current.limits
  if (!limits.autoCompact || limits.maxBytes <= 0) return null
  if (current.bytes <= limits.maxBytes * 0.9) return null
  return compactMemory('auto')
}

// ---------------------------------------------------------------------------
// 记忆库初始化
// ---------------------------------------------------------------------------
async function ensureMemory() {
  const home = await memoryHome()
  const dir = home.dir
  const created = []
  const defaults = [
    ['limits', DEFAULT_LIMITS],
    ['profile', DEFAULT_PROFILE],
    ['persona', DEFAULT_PERSONA],
    ['plan', { version: 1, plans: [] }],
    ['ledger', { version: 1, items: [] }],
    ['literature', { version: 1, items: [] }],
  ]
  for (const [key, value] of defaults) {
    if ((await readText(filePath(key))) === null) { await writeJson(filePath(key), value); created.push(FILES[key]) }
  }
  for (const key of ['notes', 'draft', 'overview']) {
    if ((await readText(filePath(key))) === null) { await writeText(filePath(key), ''); created.push(FILES[key]) }
  }
  await mkdir(join(repoRootCache(), MEMORIES_DIR), { recursive: true })
  return { home, created }
}

// ---------------------------------------------------------------------------
// 记忆条目：memories/<时间>-<slug>.md，只展示用户/模型新建的内容
// ---------------------------------------------------------------------------
function memoriesRoot() { return join(repoRootCache(), MEMORIES_DIR) }

function slugOf(text, fallback) {
  const raw = String(text || '').trim().toLowerCase()
  const ascii = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
  return ascii || fallback
}

async function rememberMemory(title, content) {
  await ensureMemory()
  const now = new Date()
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const slug = slugOf(title, 'memory')
  let name = stamp + '-' + slug + '.md'
  let index = 2
  while ((await readText(join(memoriesRoot(), name))) !== null) {
    name = stamp + '-' + slug + '-' + index + '.md'
    index += 1
  }
  const body = '# ' + (title || '记忆') + '\n\n> ' + now.toISOString() + '\n\n' + String(content || '') + '\n'
  await writeText(join(memoriesRoot(), name), body)
  await maybeCompact()
  return { name, at: now.toISOString() }
}

async function listMemories(limit) {
  const dir = memoriesRoot()
  let entries = []
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return [] }
  const rows = []
  for (const entry of entries) {
    if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue
    try {
      const info = await stat(join(dir, entry.name))
      const text = (await readText(join(dir, entry.name))) || ''
      const titleLine = text.split('\n').find(line => /^#\s+/.test(line))
      rows.push({
        name: entry.name,
        title: titleLine ? titleLine.replace(/^#\s+/, '').trim() : entry.name.replace(/\.md$/i, ''),
        at: info.mtime.toISOString(),
        bytes: info.size,
        content: capText(text, 4000),
      })
    } catch { /* 忽略单条读取失败 */ }
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return rows.slice(0, Math.max(1, Math.min(200, Number(limit) || 100)))
}

async function deleteMemory(name) {
  const safe = String(name || '').replace(/[\\/]/g, '')
  if (!/\.md$/i.test(safe)) throw new Error('只能删除 memories 下的 .md 记忆')
  try { await unlink(join(memoriesRoot(), safe)) } catch { /* 已不存在 */ }
  return safe
}

// ---------------------------------------------------------------------------
// 人格
// ---------------------------------------------------------------------------
let personaCache = Object.assign({}, DEFAULT_PERSONA)
let profileCache = Object.assign({}, DEFAULT_PROFILE)

async function loadPersona() { const value = Object.assign({}, DEFAULT_PERSONA, await readJson(filePath('persona'), DEFAULT_PERSONA)); personaCache = value; return value }
async function loadProfile() { const value = Object.assign({}, DEFAULT_PROFILE, await readJson(filePath('profile'), DEFAULT_PROFILE)); profileCache = value; return value }

/** systemPrompt 的 text 必须是同步字符串：这里只读内存缓存，不 await。 */
function personaPromptText() {
  const persona = personaCache
  const profile = profileCache
  const conceptKeys = Object.keys(profile.concepts || {}).slice(0, 12)
  const conceptText = conceptKeys.length === 0 ? '暂无概念熟悉度记录' : conceptKeys.map(key => '「' + key + '」' + (CONCEPT_LEVEL_LABEL[profile.concepts[key]] || '未知')).join('、')
  return [
    '[Muse 人格] 你叫「' + (persona.name || 'Muse') + '」，语气：' + (persona.tone || '温和严谨') + '；讲解深度：' + (persona.depth || '跟随画像') + '；语言：' + (persona.language || '中文') + '。',
    '表达风格：' + (persona.style || '先结论后展开。'),
    persona.custom ? '用户特别要求：' + persona.custom : '',
    '[用户画像] 能力等级：' + (profile.level || 'unknown') + '；概念熟悉度：' + conceptText + '。' + (profile.summary || ''),
    '[记忆纪律] 学习/科研事项用 muse_ledger 记三态；画像更新用 muse_profile save；文献只引用 muse_literature 核验通过的条目。',
  ].filter(Boolean).join('\n')
}

async function refreshPromptCaches() {
  try { await loadPersona(); await loadProfile() } catch { /* 启动早期文件可能未就绪 */ }
}

// ---------------------------------------------------------------------------
// 采集：llm/stream 全量思考与正文（旁路，不阻断）
// ---------------------------------------------------------------------------
let captureQueue = Promise.resolve()

function enqueueCapture(reasoning, text) {
  const reasoningText = String(reasoning || '')
  const bodyText = String(text || '')
  if (!reasoningText && !bodyText) return
  captureQueue = captureQueue.then(async () => {
    try {
      await ensureMemory()
      const record = { at: nowIso(), reasoning: capText(reasoningText, 4000), text: capText(bodyText, 4000) }
      const path = filePath('conversations')
      await rotateCaptureLog()
      await appendFile(path, JSON.stringify(record) + '\n', 'utf8')
      const profile = await loadProfile()
      profile.captures = (profile.captures || 0) + 1
      profile.reasoningChars = (profile.reasoningChars || 0) + reasoningText.length
      profile.updatedAt = nowIso()
      await writeJson(filePath('profile'), profile)
      profileCache = profile
      await maybeCompact()
    } catch { /* 采集永不阻断模型 */ }
  }).catch(() => {})
}

/** 包装全部模型流：原样透传，结束时旁路落盘思考与正文；任何异常都不影响模型。 */
function wrapModelStream(source) {
  return (async function* wrapped() {
    let reasoning = ''
    let text = ''
    try {
      for await (const chunk of source) {
        try {
          if (chunk && chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') reasoning += chunk.text
          else if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        } catch { /* 单个块解析失败不影响透传 */ }
        yield chunk
      }
    } finally {
      try { enqueueCapture(reasoning, text) } catch { /* 忽略 */ }
    }
  })()
}

function userTextOfEvent(event) {
  const parts = []
  const seen = new Set()
  function walk(value, depth) {
    if (depth > 6 || value === null || value === undefined) return
    if (typeof value === 'string') {
      const text = value.replace(/\s+/g, ' ').trim()
      if (text.length >= 2 && !seen.has(text)) { seen.add(text); parts.push(text) }
      return
    }
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return }
    if (typeof value !== 'object') return
    const role = typeof value.role === 'string' ? value.role : ''
    const kind = typeof value.kind === 'string' ? value.kind : ''
    const roleUser = /^(user|human)$/i.test(role)
    const kindUser = /^user[-_/.]?message/i.test(kind) || /^(user|input|prompt)$/i.test(kind)
    const excluded = /system|assistant|tool|result|reasoning/i.test(kind) || /system|assistant|tool/i.test(role)
    if (!excluded && (roleUser || kindUser)) {
      for (const key of ['text', 'content', 'message', 'body']) if (value[key] !== undefined) walk(value[key], depth + 1)
      return
    }
    for (const key of Object.keys(value)) walk(value[key], depth + 1)
  }
  walk(event, 0)
  return parts.join(' ').slice(0, 600)
}

function noteUserEvidence(text) {
  if (!text || text.length < 3) return
  if (text.indexOf('[Muse 人格]') >= 0 || /^system\//i.test(text)) return
  captureQueue = captureQueue.then(async () => {
    try {
      await ensureMemory()
      const profile = await loadProfile()
      const evidence = Array.isArray(profile.evidence) ? profile.evidence : []
      evidence.push({ at: nowIso(), text: capText(text, 400) })
      profile.evidence = evidence.slice(-30)
      profile.updatedAt = nowIso()
      await writeJson(filePath('profile'), profile)
      profileCache = profile
    } catch { /* 忽略 */ }
  }).catch(() => {})
}

// ---------------------------------------------------------------------------
// 会话摘要（画像原料）
// ---------------------------------------------------------------------------
let persistence = null

function textOfNode(node) {
  const parts = []
  const seen = new Set()
  function walk(value, depth) {
    if (depth > 6 || value === null || value === undefined) return
    if (typeof value === 'string') {
      const text = value.replace(/\s+/g, ' ').trim()
      if (text.length >= 2 && !seen.has(text)) { seen.add(text); parts.push(text) }
      return
    }
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return }
    if (typeof value !== 'object') return
    for (const key of ['text', 'content', 'value', 'message', 'body']) if (typeof value[key] === 'string') walk(value[key], depth + 1)
    for (const key of ['blocks', 'content', 'parts', 'children']) if (Array.isArray(value[key])) walk(value[key], depth + 1)
  }
  walk(node, 0)
  return parts.join(' ')
}

function collectUserTexts(events, sink, limitPerEvent) {
  function visit(value, depth) {
    if (depth > 8 || value === null || value === undefined) return
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return }
    if (typeof value !== 'object') return
    const role = value.role
    const kind = typeof value.kind === 'string' ? value.kind : ''
    if ((typeof role === 'string' && /^(user|human)$/i.test(role)) || (kind.length > 0 && /user/i.test(kind) && !/tool|result/i.test(kind))) {
      const text = textOfNode(value)
      if (text.length > 0) sink.push(capText(text, limitPerEvent))
      return
    }
    for (const key of Object.keys(value)) visit(value[key], depth + 1)
  }
  for (const event of events) visit(event, 0)
}

async function collectSessions(options) {
  if (!persistence || typeof persistence.list !== 'function') {
    throw new Error('会话持久化服务不可用，无法读取全部对话。请先用当前会话上下文生成画像。')
  }
  const sessions = await persistence.list()
  const limitSessions = Math.max(1, Math.min(50, Number(options.limitSessions) || 20))
  const limitPerEvent = Math.max(120, Math.min(2000, Number(options.limitPerMessage) || 600))
  const rows = []
  let total = 0
  for (const snapshot of sessions.slice(0, limitSessions)) {
    const id = snapshot.id || (snapshot.header && snapshot.header.id) || snapshot.sessionId
    if (!id) continue
    let handle = null
    try {
      handle = await persistence.open(id, 'read')
      const slice = await handle.read(0, 4000)
      const events = Array.isArray(slice.events) ? slice.events : []
      const texts = []
      collectUserTexts(events, texts, limitPerEvent)
      const digest = capText(texts.slice(-12).join('\n'), 1600)
      if (digest.length === 0) continue
      total += digest.length
      rows.push({ id, messageCount: texts.length, digest })
      if (total >= 24000) break
    } catch (error) {
      rows.push({ id, error: String((error && error.message) || error) })
    } finally {
      if (handle && typeof handle.close === 'function') { try { await handle.close() } catch { /* 忽略 */ } }
    }
  }
  return { count: rows.length, rows }
}

// ---------------------------------------------------------------------------
// 台账 / 提醒
// ---------------------------------------------------------------------------
function validateLedgerItem(item) {
  if (!item || typeof item !== 'object') throw new Error('台账条目必须是对象')
  for (const key of ['id', 'kind', 'title', 'stage', 'code', 'detail', 'nextAction', 'tri']) if (!item[key]) throw new Error('台账条目缺字段 ' + key)
  if (TRI.indexOf(item.tri) < 0) throw new Error('三态必须是 done/missing/unknown')
}

function buildReminders(ledger, nowValue) {
  const now = nowValue ? new Date(nowValue) : new Date()
  const items = Array.isArray(ledger.items) ? ledger.items : []
  const reminders = []
  for (const item of items) {
    if (item.tri === 'done' || !item.checkAt) continue
    const check = new Date(item.checkAt)
    if (Number.isNaN(check.getTime())) continue
    if (check.getTime() <= now.getTime()) {
      reminders.push({ priority: 0, type: 'due', id: item.id, title: item.title, lines: [
        '「' + item.title + '」预设检查时间 ' + fmtTime(item.checkAt) + ' 已到。',
        '阶段：' + item.stage + '；卡点（' + TRI_LABEL[item.tri] + '）：' + ((BLOCKER_LIBRARY[item.code] || {}).label || item.code),
        '缺口：' + item.detail,
        '追问：' + ((BLOCKER_LIBRARY[item.code] || {}).probe || []).join(' / '),
        '下一步：' + item.nextAction,
      ] })
    }
  }
  const clusters = new Map()
  for (const item of items) {
    if (item.tri !== 'unknown') continue
    const list = clusters.get(item.kind) || []
    list.push(item)
    clusters.set(item.kind, list)
  }
  for (const [kind, group] of clusters) {
    if (group.length < UNKNOWN_THRESHOLD) continue
    reminders.push({ priority: 1, type: 'unknown_cluster', kind, ids: group.map(item => item.id), lines: ['「' + kind + '」下有 ' + group.length + ' 项状态未知堆积（阈值 ' + UNKNOWN_THRESHOLD + '），请逐项确认：'].concat(group.map(item => '- [' + item.id + '] ' + item.title + '｜' + item.stage + '｜' + item.detail + '｜追问：' + ((BLOCKER_LIBRARY[item.code] || {}).probe || []).join(' '))) })
  }
  reminders.sort((a, b) => a.priority - b.priority)
  return reminders
}

function renderReminders(reminders) {
  if (reminders.length === 0) return '当前没有到期项，也没有未知堆积项。'
  const out = ['【Muse 条件化提醒】', '']
  reminders.forEach((reminder, index) => {
    out.push((index + 1) + '. ' + (reminder.type === 'due' ? '到点提醒' : '未知堆积（' + reminder.kind + '）'))
    for (const line of reminder.lines) out.push('   ' + line)
    out.push('')
  })
  out.push('（以上为待复核的缺口与追问建议，仅作学习/复现判断辅助，不构成学术不端认定。）')
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// 文献核验
// ---------------------------------------------------------------------------
function normalizeTokens(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').split(' ').filter(token => token.length > 1)
}
function titleOverlap(query, candidate) {
  const a = new Set(normalizeTokens(query))
  const b = new Set(normalizeTokens(candidate))
  if (a.size === 0 || b.size === 0) return 0
  let hit = 0
  for (const token of a) if (b.has(token)) hit += 1
  return hit / a.size
}
async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, { headers: { 'user-agent': 'dsh-muse/1.0 (learning assistant)', accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs || 15000) })
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + url)
  return await response.json()
}
function doiOf(query) { const match = String(query).match(/\b(10\.\d{4,9}\/[^\s"<>]+)\b/); return match ? match[1] : '' }
async function verifyCrossref(query) {
  const doi = doiOf(query)
  if (doi) {
    try {
      const data = await fetchJson('https://api.crossref.org/works/' + encodeURIComponent(doi))
      const item = data && data.message
      if (item) return { source: 'crossref', verified: true, confidence: 1, title: Array.isArray(item.title) ? item.title[0] : item.title || '', authors: Array.isArray(item.author) ? item.author.map(a => [a.given, a.family].filter(Boolean).join(' ')).slice(0, 8) : [], year: (item.issued && item.issued['date-parts'] && item.issued['date-parts'][0] && item.issued['date-parts'][0][0]) || null, venue: Array.isArray(item['container-title']) ? item['container-title'][0] : item['container-title'] || '', doi: item.DOI || doi, url: item.URL || ('https://doi.org/' + doi) }
    } catch (error) { return { source: 'crossref', verified: false, error: String((error && error.message) || error) } }
  }
  try {
    const url = 'https://api.crossref.org/works?rows=3&select=title,author,issued,DOI,container-title,URL&query.bibliographic=' + encodeURIComponent(query)
    const data = await fetchJson(url)
    const items = (data && data.message && data.message.items) || []
    let best = null
    for (const item of items) {
      const title = Array.isArray(item.title) ? item.title[0] : item.title || ''
      const score = titleOverlap(query, title)
      if (!best || score > best.score) best = { source: 'crossref', confidence: Number(score.toFixed(2)), verified: score >= 0.5, title, authors: Array.isArray(item.author) ? item.author.map(a => [a.given, a.family].filter(Boolean).join(' ')).slice(0, 8) : [], year: (item.issued && item.issued['date-parts'] && item.issued['date-parts'][0] && item.issued['date-parts'][0][0]) || null, venue: Array.isArray(item['container-title']) ? item['container-title'][0] : item['container-title'] || '', doi: item.DOI || '', url: item.URL || (item.DOI ? 'https://doi.org/' + item.DOI : ''), score }
    }
    if (!best || !best.verified) return { source: 'crossref', verified: false, confidence: best ? best.confidence : 0, title: best ? best.title : '', reason: 'Crossref 未检出足够相似标题' }
    delete best.score
    return best
  } catch (error) { return { source: 'crossref', verified: false, error: String((error && error.message) || error) } }
}
async function verifyPubMed(query) {
  try {
    const search = await fetchJson('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=3&term=' + encodeURIComponent(query))
    const ids = (search && search.esearchresult && search.esearchresult.idlist) || []
    if (ids.length === 0) return { source: 'pubmed', verified: false, reason: 'PubMed 未检出' }
    const summary = await fetchJson('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=' + encodeURIComponent(ids.join(',')))
    const result = (summary && summary.result) || {}
    let best = null
    for (const id of ids) {
      const item = result[id]
      if (!item) continue
      const score = titleOverlap(query, item.title || '')
      if (!best || score > best.score) best = { id, item, score }
    }
    if (!best) return { source: 'pubmed', verified: false, reason: 'PubMed 摘要缺失' }
    return { source: 'pubmed', verified: best.score >= 0.5, confidence: Number(best.score.toFixed(2)), title: best.item.title || '', authors: Array.isArray(best.item.authors) ? best.item.authors.map(a => a.name).slice(0, 8) : [], year: best.item.pubdate ? String(best.item.pubdate).slice(0, 4) : null, venue: best.item.fulljournalname || best.item.source || '', doi: (best.item.articleids || []).map(a => a.value).find(v => String(v).startsWith('10.')) || '', pmid: best.id, url: 'https://pubmed.ncbi.nlm.nih.gov/' + best.id + '/' }
  } catch (error) { return { source: 'pubmed', verified: false, error: String((error && error.message) || error) } }
}
async function verifyLiterature(queries) {
  const results = []
  for (const query of queries) {
    const trimmed = String(query || '').trim()
    if (!trimmed) continue
    const crossref = await verifyCrossref(trimmed)
    let chosen = crossref
    if (!crossref.verified) {
      const pubmed = await verifyPubMed(trimmed)
      if (pubmed.verified) chosen = pubmed
      else if (!crossref.error && !pubmed.error) chosen = { query: trimmed, verified: false, source: 'crossref+pubmed', reason: 'Crossref 与 PubMed 均未检出可核对条目' }
      else chosen = crossref.error ? pubmed : crossref
    }
    results.push(Object.assign({ query: trimmed }, chosen))
  }
  return results
}

// ---------------------------------------------------------------------------
// 统计 / 精读 / 写作 / 启发
// ---------------------------------------------------------------------------
const DESIGN_RULES = [
  { match: /配对|paired|前后|pre.?post|重复测量/, test: '配对 t 检验 / Wilcoxon 符号秩检验', notes: '先看差值正态性；样本少用 Wilcoxon。', py: 'from scipy import stats\nstats.ttest_rel(a, b)  # 或 stats.wilcoxon(a, b)' },
  { match: /两组|two.?group|对照|control|独立|independent/, test: '独立样本 t 检验 / Mann-Whitney U', notes: '先做方差齐性（Levene）；不齐用 Welch。', py: 'from scipy import stats\nstats.ttest_ind(a, b, equal_var=False)  # 或 stats.mannwhitneyu(a, b)' },
  { match: /多组|three|多水平|anova|组间/, test: '单因素 ANOVA / Kruskal-Wallis + 事后检验', notes: '显著后再做 Tukey 或 Dunn，需校正多重比较。', py: 'from scipy import stats\nstats.f_oneway(g1, g2, g3)  # 或 stats.kruskal(g1, g2, g3)' },
  { match: /分类|卡方|chi|列联|比例|proportion/, test: '卡方检验 / Fisher 精确检验', notes: '期望频数 <5 用 Fisher；报告效应量（Cramér V）。', py: 'from scipy import stats\nstats.chi2_contingency(table)  # 小样本 stats.fisher_exact(table)' },
  { match: /相关|correlation|关联强度/, test: 'Pearson / Spearman 相关', notes: '非线性或离群值多用 Spearman；报告 r 与置信区间。', py: 'from scipy import stats\nstats.pearsonr(x, y)  # 或 stats.spearmanr(x, y)' },
  { match: /回归|预测|regression|线性|logistic|影响因素/, test: '线性 / Logistic 回归', notes: '检查共线性（VIF）与残差；报告系数、OR/β 与 CI。', py: 'import statsmodels.api as sm\nsm.OLS(y, sm.add_constant(X)).fit().summary()' },
  { match: /生存|survival|随访|time.?to.?event/, test: 'Kaplan-Meier + Log-rank / Cox 回归', notes: '检查比例风险假设；报告 HR 与 CI。', py: 'from lifelines import KaplanMeierFitter, CoxPHFitter\nKaplanMeierFitter().fit(t, e).plot()' },
  { match: /时间序列|time.?series|趋势|季节性/, test: '平稳性检验 + 差分 / ARIMA', notes: '先 ADF 检验，差分后再建模；报告 ACF/PACF。', py: 'from statsmodels.tsa.stattools import adfuller\nadfuller(series)' },
  { match: /多重|multiple|多重比较|family.?wise/, test: '多重比较校正（Bonferroni / FDR）', notes: '校正后仍显著才可下结论；报告校正方法与阈值。', py: 'from statsmodels.stats.multitest import multipletests\nmultipletests(pvals, method="fdr_bh")' },
]

function statsPlan(design, outcome, sample) {
  const text = String(design || '') + ' ' + String(outcome || '')
  const hits = DESIGN_RULES.filter(rule => rule.match.test(text))
  const lines = ['# 统计方案建议', '', '研究设计：' + (design || '（未提供）')]
  if (outcome) lines.push('结局变量：' + outcome)
  if (sample) lines.push('样本量：' + sample)
  lines.push('')
  if (hits.length === 0) {
    lines.push('未识别到明确的检验关键词。请补充：分组数、是否配对、结局变量类型（连续/分类/时间）、样本量。')
    lines.push('')
    lines.push('通用检查清单：')
    lines.push(bullets(['明确研究假设与零假设', '检查数据分布与离群值', '确认独立性与方差齐性', '报告效应量与 95% 置信区间', '记录多重比较校正方式']))
    return lines.join('\n')
  }
  for (const rule of hits) {
    lines.push('## ' + rule.test)
    lines.push('- 适用与假设：' + rule.notes)
    lines.push('- 参考实现：')
    lines.push('```python')
    lines.push(rule.py)
    lines.push('```')
    lines.push('')
  }
  lines.push('## 报告清单')
  lines.push(bullets(['效应量与 95% CI，而不只报 p 值', '样本量与检验力说明', '缺失值与异常值处理', '多重比较校正', '随机种子与可复现代码路径']))
  return lines.join('\n')
}

function explainDepth(level) {
  if (level === 'beginner') return '从问题与直觉讲起，先给一个最小例子，再给公式与术语；避免默认读者懂领域黑话。'
  if (level === 'advanced') return '直接给方法定位、关键假设与与已有工作的差异；省略基础定义。'
  return '先给结论与框架，再按需展开关键步骤；术语首次出现时附一句解释。'
}

function paperAnalysis(title, notes, profile) {
  const concepts = profile.concepts || {}
  const conceptText = Object.keys(concepts).slice(0, 12).map(key => '「' + key + '」' + (CONCEPT_LEVEL_LABEL[concepts[key]] || '未知')).join('、') || '暂无'
  const lines = ['# 论文精读分析：' + (title || '（未命名）'), '', '## 读者画像适配', '- 能力等级：' + (profile.level || 'unknown') + '；概念熟悉度：' + conceptText, '- 讲解深度：' + explainDepth(profile.level), '']
  lines.push('## 必答清单（逐项写结论，不确定就标 unknown）')
  for (const [name, hint] of [['研究问题', '它要解决什么、为什么现有方法不够'], ['核心方法', '关键模块、假设、与基线差异'], ['数据', '来源、规模、划分方式、预处理'], ['评价', '指标定义、基线设置、统计显著性'], ['消融', '每个模块的贡献、单变量性'], ['局限', '作者承认的与未承认的边界'], ['可复现性', '种子、超参范围、依赖版本、代码/数据可用性']]) lines.push('- ' + name + '：' + hint)
  lines.push('')
  if (notes) { lines.push('## 你的笔记'); lines.push(capText(notes, 4000)); lines.push('') }
  lines.push('## 可复现性缺口（用三态记录）')
  lines.push(bullets(['随机种子是否记录（seed_missing）', '数据划分方式是否说明（split_unknown）', '超参搜索范围是否披露（hyperparam_range）', '依赖版本是否锁定（dep_version）', '消融配置是否单变量（ablation_config）']))
  lines.push('')
  lines.push('## 下一步')
  lines.push('- 把上述结论用 muse_ledger 逐条落成三态条目；unknown 堆积到 3 项时用 muse_reminder 生成追问。')
  return lines.join('\n')
}

function draftOutline(plan, ledger, literature) {
  const plans = (plan && plan.plans) || []
  const items = (ledger && ledger.items) || []
  const refs = (literature && literature.items) || []
  const lines = ['# 研究梳理与初稿大纲', '']
  if (plans.length > 0) { lines.push('## 研究计划'); for (const p of plans) lines.push('- ' + (p.title || '未命名计划') + (p.goal ? '：' + p.goal : '')); lines.push('') }
  lines.push('## 建议章节')
  for (const [name, hint] of [['1. 研究问题与动机', '问题背景、现有方法不足、本文切入点'], ['2. 相关工作', '用核验过的文献填充，标注 DOI/PMID'], ['3. 方法', '核心假设、模块、与基线差异'], ['4. 实验设置', '数据、划分、指标、超参、种子'], ['5. 结果与分析', '主结果、消融、统计检验'], ['6. 讨论与局限', '边界、失败案例分析、可复现性'], ['7. 结论', '一句话贡献 + 未来工作']]) lines.push('- ' + name + '：' + hint)
  lines.push('')
  if (items.length > 0) {
    const missing = items.filter(item => item.tri !== 'done')
    lines.push('## 待补证据（' + missing.length + ' 项）')
    for (const item of missing.slice(0, 20)) lines.push('- [' + item.id + '] ' + item.title + '｜' + TRI_LABEL[item.tri] + '｜' + item.detail)
    lines.push('')
  }
  if (refs.length > 0) {
    lines.push('## 已核验文献')
    for (const ref of refs.filter(item => item.verified).slice(0, 30)) lines.push('- ' + [ref.authors && ref.authors[0], ref.year, ref.title, ref.venue, ref.doi ? 'doi:' + ref.doi : (ref.pmid ? 'pmid:' + ref.pmid : '')].filter(Boolean).join(' · '))
    lines.push('')
  }
  lines.push('## 写作纪律')
  lines.push(bullets(['每条结论都必须能指回实验或文献，不写无出处断言', '统计报告含效应量与置信区间，不只报 p', '引用只用经 Crossref/PubMed 核验过的条目', '初稿后按 muse_draft action=polish 逐项自检']))
  return lines.join('\n')
}

function polishChecklist() {
  return ['# 润色与投稿前自检', ''].concat(bullets([
    '主张与证据一一对应：每个结论能否指回图表/实验/引用',
    '术语一致：同一概念全文同一译名与缩写',
    '统计报告完整：效应量、CI、样本量、检验方法、校正方式',
    '引用完整性：无「待补」占位，DOI/PMID 已核验',
    '可复现性：种子、划分、超参范围、依赖版本写进正文或附录',
    '图表自明：标题、坐标轴、单位、误差线含义',
    '局限与失败案例：主动写出，不回避',
    '语言：长句拆分、被动语态适度、避免绝对化措辞',
  ])).join('\n')
}

function inspireBrief(topic, mode, profile) {
  const lines = ['# ' + (mode === 'reproduce' ? '复现路线' : mode === 'ideas' ? '启发与延伸' : '如何上手使用'), '', '主题：' + (topic || '（未提供）'), '读者等级：' + (profile.level || 'unknown'), '']
  if (mode === 'reproduce') {
    lines.push('## 复现路线（按顺序）')
    lines.push(bullets(['环境冻结：记录框架/CUDA/依赖版本，导出 environment 文件', '数据核对：来源、划分比例、预处理脚本逐行对照', '主结果复现：固定种子跑通 baseline，再对齐指标定义', '超参对齐：记录搜索区间与选值依据，避免测试集调参', '消融复现：每次只改一个因素，记录参数量/步数是否同步', '差异归因：列出与原文不一致的指标并逐项定位']))
    lines.push('')
    lines.push('## 每步用台账记录')
    lines.push('- 用 muse_ledger 添加 seed_missing / split_unknown / hyperparam_range / dep_version / ablation_config 条目。')
  } else if (mode === 'ideas') {
    lines.push('## 延伸方向')
    lines.push(bullets(['换数据分布或跨域场景，检验方法边界', '换评价指标，看结论是否稳健', '拆解模块做单变量消融，找真正的贡献来源', '与相邻方法组合，做最小可行对比', '把失败案例整理成负面结果，写成局限']))
    lines.push('')
    lines.push('## 判断标准')
    lines.push('- 新想法必须能用一句话说清「相对谁、改进什么、如何验证」。')
  } else {
    lines.push('## 上手三步')
    lines.push(bullets(['先让 Agent 读取本文并落成台账条目（muse_ledger）', '用 muse_analysis action=paper 生成必答清单，逐项补 unknown', '用 muse_plan 生成个性化计划，再用 muse_reminder 设置检查点']))
    lines.push('')
    lines.push('## 提示')
    lines.push('- 概念不熟时先补概念，再看公式与实验表格；muse_profile 会记录概念熟悉度。')
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
const OUTPUT_SCHEMA = { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, data: { type: 'string' } }, required: ['ok', 'data'] }
function renderOutput(args, value) { return [{ type: 'text', text: String(value && value.data !== undefined ? value.data : '') }] }
function makeTool(options) {
  return {
    name: options.name,
    description: options.description,
    parameters: { type: 'object', additionalProperties: false, properties: options.parameters || {} },
    output: { schema: OUTPUT_SCHEMA, render: renderOutput },
    async execute(args) { const data = await options.run(args || {}); return { ok: true, data: String(data) } },
  }
}

async function runMemoryTool(args) {
  const action = String(args.action || 'status').toLowerCase()
  if (action === 'init') {
    const created = await ensureMemory()
    const current = await usage()
    return ['记忆库已就绪：' + current.dir + '\n宿主：' + (created.home.host && created.home.host.app || created.home.app) + '\n' + (created.created.length ? '新建：' + created.created.join('、') : '复用已有文件') + '\n\n' + statusText(current)].join('\n')
  }
  if (action === 'compact') {
    const report = await compactMemory('manual')
    return ['压缩完成：' + report.beforeBytes + ' → ' + report.afterBytes + ' bytes', ...report.actions.map(item => '- ' + item)].join('\n')
  }
  if (action === 'read') {
    const key = String(args.key || 'profile')
    if (!FILES[key]) throw new Error('未知记忆文件：' + key)
    const text = await readText(filePath(key))
    if (text === null) throw new Error('记忆库尚未初始化，先调用 muse_memory action=init')
    return text
  }
  if (action === 'write') {
    const key = String(args.key || '')
    if (['notes', 'draft', 'overview'].indexOf(key) < 0) throw new Error('write 只接受 notes / draft / overview；结构化文件请用各自工具的 save')
    await ensureMemory()
    const bytes = await writeText(filePath(key), String(args.content || ''))
    await maybeCompact()
    return '已写入 ' + FILES[key] + '（' + bytes + ' bytes）'
  }
  if (action === 'append') {
    const key = String(args.key || 'notes')
    if (['notes', 'overview'].indexOf(key) < 0) throw new Error('append 只支持 notes / overview')
    await ensureMemory()
    const existing = (await readText(filePath(key))) || ''
    const next = existing + (existing.endsWith('\n') || existing.length === 0 ? '' : '\n') + '## ' + nowIso() + '\n' + String(args.content || '') + '\n'
    const bytes = await writeText(filePath(key), next)
    await maybeCompact()
    return '已追加到 ' + FILES[key] + '（' + bytes + ' bytes）'
  }
  if (action === 'remember') {
    const created = await rememberMemory(String(args.title || '记忆'), String(args.content || ''))
    return '已新建记忆：' + created.name + '（' + fmtTime(created.at) + '）'
  }
  if (action === 'memories') {
    const rows = await listMemories(50)
    if (rows.length === 0) return '还没有新建记忆。用 muse_memory action=remember 记录一条。'
    return ['# 记忆（' + rows.length + ' 条，按时间倒序）', ''].concat(rows.map(row => '## ' + row.title + '\n' + fmtTime(row.at) + ' · ' + row.bytes + ' bytes\n\n' + row.content)).join('\n')
  }
  if (action === 'delete-memory') {
    const removed = await deleteMemory(String(args.name || ''))
    return '已删除记忆：' + removed
  }
  const current = await usage()
  return statusText(current)
}

function statusText(current) {
  const lines = ['记忆库：' + current.dir, '容量：' + current.bytes + ' bytes / ' + (current.limits.maxBytes > 0 ? current.limits.maxBytes + ' bytes（' + current.percent + '%）' : '不限'), '', '文件：']
  for (const file of current.files) lines.push('- ' + file.name.padEnd(24) + file.bytes + ' bytes')
  lines.push('')
  lines.push('提示：muse_memory action=compact 可手动压缩；超限时自动压缩。')
  return lines.join('\n')
}

async function runProfileTool(args) {
  const action = String(args.action || 'get').toLowerCase()
  await ensureMemory()
  if (action === 'get') {
    const profile = await loadProfile()
    return ['# 用户画像', '', '- 能力等级：' + (profile.level || 'unknown'), '- 概念熟悉度：' + (Object.keys(profile.concepts || {}).length ? Object.keys(profile.concepts).map(key => '「' + key + '」' + (CONCEPT_LEVEL_LABEL[profile.concepts[key]] || '未知')).join('、') : '暂无'), '- 兴趣：' + ((profile.interests || []).join('、') || '暂无'), '- 采集：' + (profile.captures || 0) + ' 段思考/正文，' + (profile.reasoningChars || 0) + ' 字符', '', '摘要：' + (profile.summary || '暂无'), '', '```json', JSON.stringify(profile, null, 2), '```'].join('\n')
  }
  if (action === 'collect') {
    if (!persistence) return '会话持久化服务不可用，无法读取全部对话。请改用当前会话上下文生成画像。'
    const digest = await collectSessions(args)
    if (digest.count === 0) return '没有读到可用的用户消息。'
    const lines = ['# 会话摘录（用于画像归纳，共 ' + digest.count + ' 个会话）', '', '请归纳：能力等级、熟悉概念、研究方向、学习偏好、待补短板，然后用 muse_profile action=save 写入。', '']
    for (const row of digest.rows) { lines.push('## 会话 ' + row.id); if (row.error) lines.push('（读取失败：' + row.error + '）'); else lines.push('消息数：' + row.messageCount + '\n\n' + row.digest); lines.push('') }
    return lines.join('\n')
  }
  if (action === 'save') {
    let incoming
    try { incoming = JSON.parse(String(args.content || '{}')) } catch { throw new Error('content 必须是合法 JSON') }
    const current = await loadProfile()
    const merged = Object.assign({}, current, incoming, { version: 1, updatedAt: nowIso(), concepts: Object.assign({}, current.concepts || {}, incoming.concepts || {}), interests: incoming.interests || current.interests || [] })
    if (['beginner', 'intermediate', 'advanced', 'unknown'].indexOf(merged.level) < 0) merged.level = current.level || 'unknown'
    await writeJson(filePath('profile'), merged)
    profileCache = merged
    await maybeCompact()
    return ['画像已保存。', '- 能力等级：' + merged.level, '- 概念：' + Object.keys(merged.concepts || {}).length + ' 个', '- 摘要：' + (merged.summary || '')].join('\n')
  }
  throw new Error('未知 action：' + action)
}

async function runPersonaTool(args) {
  const action = String(args.action || 'get').toLowerCase()
  await ensureMemory()
  const persona = await loadPersona()
  if (action === 'get') {
    return ['# 人格设置', '```json', JSON.stringify(persona, null, 2), '```', '', '修改后用 muse_persona action=save 提交 JSON；人格会注入每一次模型调用。'].join('\n')
  }
  if (action === 'save') {
    let incoming
    try { incoming = JSON.parse(String(args.content || '{}')) } catch { throw new Error('content 必须是合法 JSON') }
    const merged = Object.assign({}, persona, incoming, { version: 1, updatedAt: nowIso() })
    await writeJson(filePath('persona'), merged)
    personaCache = merged
    return '人格已保存并即时生效：' + (merged.name || 'Muse') + ' / ' + (merged.tone || '') + ' / ' + (merged.depth || '')
  }
  throw new Error('未知 action：' + action)
}

async function runLedgerTool(args) {
  const action = String(args.action || 'list').toLowerCase()
  await ensureMemory()
  const ledger = await readJson(filePath('ledger'), { version: 1, items: [] })
  const items = Array.isArray(ledger.items) ? ledger.items : []
  if (action === 'add') {
    const item = { id: String(args.id || 'MLL-' + String(items.length + 1).padStart(3, '0')), kind: String(args.kind || 'paper_repro'), title: String(args.title || ''), stage: String(args.stage || ''), code: String(args.code || 'not_started'), detail: String(args.detail || ''), tri: String(args.tri || 'unknown'), nextAction: String(args.nextAction || args.next || ''), checkAt: args.checkAt ? String(args.checkAt) : null, concept: args.concept ? String(args.concept) : null, updatedAt: nowIso() }
    validateLedgerItem(item)
    if (items.some(row => row.id === item.id)) throw new Error('条目 ID 已存在：' + item.id)
    items.push(item)
    ledger.items = items
    ledger.updatedAt = nowIso()
    await writeJson(filePath('ledger'), ledger)
    await maybeCompact()
    return '已新增 ' + item.id + '（' + item.title + '，' + TRI_LABEL[item.tri] + '）'
  }
  if (action === 'update') {
    const target = items.find(row => row.id === String(args.id || ''))
    if (!target) throw new Error('未找到条目：' + args.id)
    if (args.tri) { if (TRI.indexOf(String(args.tri)) < 0) throw new Error('三态必须是 done/missing/unknown'); target.tri = String(args.tri) }
    for (const key of ['detail', 'nextAction', 'stage', 'checkAt']) if (args[key] !== undefined && args[key] !== '') target[key] = String(args[key])
    target.updatedAt = nowIso()
    ledger.updatedAt = nowIso()
    await writeJson(filePath('ledger'), ledger)
    return '已更新 ' + target.id + ' → ' + TRI_LABEL[target.tri]
  }
  if (action === 'delete') {
    const id = String(args.id || '')
    ledger.items = items.filter(row => row.id !== id)
    ledger.updatedAt = nowIso()
    await writeJson(filePath('ledger'), ledger)
    return '已删除 ' + id
  }
  if (items.length === 0) return '台账为空。用 muse_ledger action=add 添加第一条。'
  return ['# 台账（' + items.length + ' 项）', ''].concat(items.map(item => '- [' + item.id + '] ' + (TRI_LABEL[item.tri] || item.tri) + '｜' + item.kind + '｜' + item.title + '｜阶段：' + item.stage + '｜缺口：' + item.detail + '｜下一步：' + item.nextAction + (item.checkAt ? '｜检查：' + fmtTime(item.checkAt) : ''))).join('\n')
}

async function runPlanTool(args) {
  const action = String(args.action || 'get').toLowerCase()
  await ensureMemory()
  const store = await readJson(filePath('plan'), { version: 1, plans: [] })
  const plans = Array.isArray(store.plans) ? store.plans : []
  if (action === 'save') {
    let incoming
    try { incoming = JSON.parse(String(args.content || '{}')) } catch { throw new Error('content 必须是 JSON（可含 title/goal/kind/horizon/milestones）') }
    const plan = Object.assign({ id: 'PLAN-' + String(plans.length + 1).padStart(3, '0'), createdAt: nowIso() }, incoming, { updatedAt: nowIso() })
    if (args.id) {
      const index = plans.findIndex(row => row.id === String(args.id))
      if (index >= 0) plans[index] = Object.assign({}, plans[index], incoming, { updatedAt: nowIso() })
      else plans.push(plan)
    } else plans.push(plan)
    store.plans = plans
    store.updatedAt = nowIso()
    await writeJson(filePath('plan'), store)
    return '计划已保存：' + plan.title
  }
  if (plans.length === 0) return '还没有计划。用 muse_plan action=save 提交 JSON 计划。'
  const lines = ['# 学习/科研计划', '']
  for (const plan of plans) {
    lines.push('## ' + (plan.title || plan.id) + (plan.kind ? '（' + plan.kind + '）' : ''))
    if (plan.goal) lines.push('目标：' + plan.goal)
    if (plan.horizon) lines.push('周期：' + plan.horizon)
    for (const milestone of (Array.isArray(plan.milestones) ? plan.milestones : [])) lines.push('- [' + (milestone.status || 'todo') + '] ' + (milestone.title || '') + (milestone.due ? '（截止 ' + milestone.due + '）' : '') + (milestone.actions ? '：' + milestone.actions.join('；') : ''))
    lines.push('')
  }
  return lines.join('\n')
}

async function runReminderTool(args) {
  await ensureMemory()
  const ledger = await readJson(filePath('ledger'), { version: 1, items: [] })
  const reminders = buildReminders(ledger, args.now)
  const text = renderReminders(reminders)
  if (String(args.action || 'check').toLowerCase() === 'schedule') {
    const due = reminders.filter(reminder => reminder.type === 'due')
    const prompt = due.length > 0 ? 'Muse 定时提醒：' + due.map(reminder => reminder.lines[0]).join('；') : 'Muse 检查点提醒：请打开 Muse 台账，检查未完成条目的三态并补一句下一步。'
    return [text, '', '## 定时任务设置建议', '- 用官方工具 schedule_create 创建任务，target 选 this_session。', '- 建议 prompt：' + prompt, '- rrule 示例：DTSTART;TZID=Asia/Shanghai:20261121T200000\nRRULE:FREQ=DAILY;COUNT=14'].join('\n')
  }
  return text
}

async function runLiteratureTool(args) {
  const queries = String(args.queries || '').split(/\n+/).map(line => line.trim()).filter(Boolean)
  if (queries.length === 0) throw new Error('queries 至少给一行标题或 DOI')
  const results = await verifyLiterature(queries)
  const verified = results.filter(item => item.verified)
  const unverified = results.filter(item => !item.verified)
  await ensureMemory()
  const store = await readJson(filePath('literature'), { version: 1, items: [] })
  const items = Array.isArray(store.items) ? store.items : []
  for (const item of verified) {
    if (items.some(row => row.verified && row.doi && item.doi && row.doi === item.doi)) continue
    items.push(Object.assign({}, item, { addedAt: nowIso() }))
  }
  store.items = items
  store.updatedAt = nowIso()
  await writeJson(filePath('literature'), store)
  const lines = ['# 文献核验（Crossref / PubMed）', '', '核验通过 ' + verified.length + ' 条，未通过 ' + unverified.length + ' 条。只有核验通过的条目才可以引用。', '']
  for (const item of verified) { lines.push('- ✅ ' + [item.authors && item.authors[0], item.year, item.title, item.venue].filter(Boolean).join(' · ')); lines.push('  ' + (item.doi ? 'doi:' + item.doi : '') + (item.pmid ? ' pmid:' + item.pmid : '') + ' · 来源 ' + item.source + ' · 置信度 ' + (item.confidence !== undefined ? item.confidence : '-') + (item.url ? ' · ' + item.url : '')) }
  for (const item of unverified) lines.push('- ❌ ' + item.query + '：' + (item.reason || item.error || '未检出'))
  lines.push('')
  lines.push('（未核验条目不会写入文献库；请换关键词或补 DOI 后重试。）')
  return lines.join('\n')
}

async function runAnalysisTool(args) {
  const action = String(args.action || 'paper').toLowerCase()
  await ensureMemory()
  const profile = await loadProfile()
  if (action === 'stats') return statsPlan(args.design, args.outcome, args.sample)
  let notes = String(args.notes || '')
  if (notes && args.fromFile === 'true') { const extra = await readText(filePath(notes)); if (extra) notes = extra }
  return paperAnalysis(String(args.title || ''), notes, profile)
}

async function runDraftTool(args) {
  const action = String(args.action || 'outline').toLowerCase()
  await ensureMemory()
  if (action === 'polish') return polishChecklist()
  const plan = await readJson(filePath('plan'), { plans: [] })
  const ledger = await readJson(filePath('ledger'), { items: [] })
  const literature = await readJson(filePath('literature'), { items: [] })
  const outline = draftOutline(plan, ledger, literature)
  if (action === 'assemble') {
    const body = outline + '\n\n---\n\n## 初稿正文（待补）\n\n（每个小节先写 3–5 句，再补证据与引用。）\n'
    await writeText(filePath('draft'), body)
    await maybeCompact()
    return '已生成初稿骨架：' + filePath('draft') + '\n\n' + outline
  }
  return outline
}

async function runInspireTool(args) {
  await ensureMemory()
  return inspireBrief(String(args.topic || ''), String(args.mode || 'howto').toLowerCase(), await loadProfile())
}

// ---------------------------------------------------------------------------
// 面板 HTTP API
// ---------------------------------------------------------------------------
function isLoopback(req) {
  const address = (req.socket && req.socket.remoteAddress) || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

async function readBody(req, limit) {
  return await new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

async function panelState() {
  await ensureMemory()
  const current = await usage()
  const profile = await loadProfile()
  const persona = await loadPersona()
  const plan = await readJson(filePath('plan'), { plans: [] })
  const ledger = await readJson(filePath('ledger'), { items: [] })
  const literature = await readJson(filePath('literature'), { items: [] })
  const previews = {}
  for (const key of ['notes', 'draft', 'overview']) previews[key] = capText(await readText(filePath(key)) || '', 1200)
  const capture = capText(await readText(filePath('conversations')) || '', 2000)
  const compaction = await readJson(filePath('compaction'), null)
  return {
    apiVersion: 4,
    host: { app: (cachedMemoryDir && cachedMemoryDir.host && cachedMemoryDir.host.app) || (cachedMemoryDir && cachedMemoryDir.app) || 'unknown', dir: current.dir, node: process.version },
    usage: { bytes: current.bytes, maxBytes: current.limits.maxBytes, percent: current.percent, autoCompact: current.limits.autoCompact },
    limits: current.limits,
    files: current.files,
    memories: await listMemories(100),
    previews,
    capture,
    compaction,
    profile,
    persona,
    plan,
    ledger,
    literature,
  }
}

async function handlePanelApi(req, res) {
  try {
    if (!isLoopback(req)) { sendJson(res, 403, { ok: false, error: 'loopback only' }); return }
    if (req.headers['x-muse-client'] !== 'dsh-muse') { sendJson(res, 403, { ok: false, error: 'missing client header' }); return }
    if (req.method === 'GET') { sendJson(res, 200, { ok: true, state: await panelState() }); return }
    if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
    const body = await readBody(req, 512 * 1024)
    let payload = {}
    try { payload = JSON.parse(body || '{}') } catch { sendJson(res, 400, { ok: false, error: 'invalid json' }); return }
    const action = String(payload.action || '')
    if (action === 'state') { sendJson(res, 200, { ok: true, state: await panelState() }); return }
    if (action === 'save-profile') {
      const incoming = payload.profile && typeof payload.profile === 'object' ? payload.profile : {}
      const current = await loadProfile()
      const merged = Object.assign({}, current, incoming, { updatedAt: nowIso(), concepts: Object.assign({}, current.concepts || {}, incoming.concepts || {}) })
      await writeJson(filePath('profile'), merged)
      profileCache = merged
      sendJson(res, 200, { ok: true, state: await panelState() }); return
    }
    if (action === 'save-persona') {
      const incoming = payload.persona && typeof payload.persona === 'object' ? payload.persona : {}
      const merged = Object.assign({}, await loadPersona(), incoming, { updatedAt: nowIso() })
      await writeJson(filePath('persona'), merged)
      personaCache = merged
      sendJson(res, 200, { ok: true, state: await panelState() }); return
    }
    if (action === 'delete-memory') {
      const removed = await deleteMemory(payload.name)
      sendJson(res, 200, { ok: true, removed, state: await panelState() }); return
    }
    if (action === 'add-memory') {
      const created = await rememberMemory(payload.title, payload.content)
      sendJson(res, 200, { ok: true, created, state: await panelState() }); return
    }
    if (action === 'save-limits') {
      const maxBytes = Number(payload.maxBytes)
      const limits = Object.assign({}, await loadLimits(), { updatedAt: nowIso() })
      if (Number.isFinite(maxBytes) && maxBytes >= 0) limits.maxBytes = Math.floor(maxBytes)
      if (payload.autoCompact !== undefined) limits.autoCompact = payload.autoCompact === true
      await writeJson(filePath('limits'), limits)
      if (limits.maxBytes > 0) await maybeCompact()
      sendJson(res, 200, { ok: true, state: await panelState() }); return
    }
    if (action === 'compact') {
      const report = await compactMemory('panel')
      sendJson(res, 200, { ok: true, report, state: await panelState() }); return
    }
    if (action === 'delete-file') {
      const key = String(payload.key || '')
      if (['notes', 'draft', 'overview', 'conversations', 'compaction', 'literature', 'plan', 'ledger'].indexOf(key) < 0) { sendJson(res, 400, { ok: false, error: '该文件不允许从面板删除' }); return }
      try { await unlink(filePath(key)) } catch { /* 已不存在 */ }
      if (key !== 'compaction' && key !== 'conversations') await writeText(filePath(key), key.endsWith('.json') ? '{}' : '')
      sendJson(res, 200, { ok: true, state: await panelState() }); return
    }
    sendJson(res, 400, { ok: false, error: 'unknown action: ' + action })
  } catch (error) {
    try { sendJson(res, 500, { ok: false, error: String((error && error.message) || error) }) } catch { /* 忽略 */ }
  }
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------
/** 单个工具注册失败只丢该工具，不让整个插件 fail-loud。 */
function safeRegister(ctx, definition) {
  try { ctx.tools.register(definition) } catch { /* 忽略单个工具注册失败 */ }
}

export function apply(ctx) {
  ctx.inject(['sessionPersistence'], (scoped) => { persistence = scoped.sessionPersistence })

  /* 首次启用即探测宿主并建立固定记忆库；失败不阻断启动。 */
  Promise.resolve().then(() => ensureMemory()).then(() => refreshPromptCaches()).catch(() => {})

  /* 人格 + 画像注入每一次模型调用的系统提示。 */
  try {
    ctx.inject(['systemPrompt'], (scoped) => {
      try {
        scoped.effect(() => scoped.systemPrompt.section({ name: 'muse-persona', order: 50, text: () => personaPromptText() }), 'dsh-muse: system section')
      } catch { /* 注入失败只影响人格，不影响工具 */ }
    })
  } catch { /* 没有 systemPrompt 服务时退化为不注入 */ }

  /* 强制接入模型流：旁路采集思考（reasoning）与正文，永不阻断。
     兼容 cordis waterfall 的两种调用形态：(options, next) / (thisArg, options, next)。 */
  try {
    ctx.on('llm/stream', function () {
      const args = Array.prototype.slice.call(arguments)
      const next = args[args.length - 1]
      if (typeof next !== 'function') return undefined
      let source
      try { source = next() } catch (error) { throw error }
      if (!source || typeof source[Symbol.asyncIterator] !== 'function') return source
      return wrapModelStream(source)
    })
  } catch { /* 事件不存在时忽略 */ }

  /* 会话事件 → 画像证据（节流在队列里做）。 */
  try {
    ctx.on('session/event', (session, event) => {
      try {
        const kind = String((event && (event.kind || event.type || event.name)) || '')
        if (kind.length > 0 && (!/user|input|message|prompt/i.test(kind) || /system|assistant|tool|result/i.test(kind))) return
        const text = userTextOfEvent(event)
        if (text) noteUserEvidence(text)
      } catch { /* 忽略 */ }
    })
  } catch { /* 忽略 */ }

  /* 面板读写 API（仅环回 + 同源头）。 */
  try {
    ctx.inject(['webServer'], (scoped) => {
      try {
        scoped.effect(() => scoped.webServer.register({ kind: 'exact', path: '/dsh-muse/api', handler: handlePanelApi }), 'dsh-muse: panel api')
      } catch { /* 路由注册失败时面板走只读回退 */ }
    })
  } catch { /* 没有 webServer 时面板只读 */ }

  safeRegister(ctx, makeTool({ name: 'muse_memory', description: 'Muse 记忆：action=remember 新建一条记忆（标题+内容，写入 memories/，按时间倒序展示）；action=memories 列出全部记忆内容；action=delete-memory 删除；另有 init/status/read/write/append/compact 维护核心文件。容量可设为有限额或无限，超限自动压缩归档。', parameters: { action: { type: 'string', description: 'remember | memories | delete-memory | init | status | read | write | append | compact' }, title: { type: 'string', description: 'remember 的标题' }, name: { type: 'string', description: 'delete-memory 的文件名' }, key: { type: 'string', description: '核心文件键：profile/plan/ledger/literature/persona/notes/draft/overview' }, content: { type: 'string', description: 'remember/write/append 的内容' } }, run: runMemoryTool }))
  safeRegister(ctx, makeTool({ name: 'muse_profile', description: '用户画像：action=collect 读本机全部会话的用户消息摘要；action=save 保存画像 JSON；action=get 读取。画像也会随模型思考/正文采集持续更新证据。', parameters: { action: { type: 'string', description: 'collect | save | get' }, content: { type: 'string', description: 'save 时的画像 JSON' }, limitSessions: { type: 'number', description: 'collect 最多读取多少会话（默认 20）' }, limitPerMessage: { type: 'number', description: '每条消息最多保留字符（默认 600）' } }, run: runProfileTool }))
  safeRegister(ctx, makeTool({ name: 'muse_persona', description: '人格设置：名字/语气/讲解深度/语言/表达风格/自定义要求；保存后注入每一次模型调用。action=get|save。', parameters: { action: { type: 'string', description: 'get | save' }, content: { type: 'string', description: 'save 时的人格 JSON：name/tone/depth/language/style/custom' } }, run: runPersonaTool }))
  safeRegister(ctx, makeTool({ name: 'muse_ledger', description: '三态台账：done/missing/unknown；action=add/update/delete/list。未知堆积是条件化提醒的燃料。', parameters: { action: { type: 'string', description: 'add | update | delete | list' }, id: { type: 'string', description: '条目 ID' }, kind: { type: 'string', description: 'course | paper_repro | paper_read | review' }, title: { type: 'string', description: '事项名' }, stage: { type: 'string', description: '当前阶段' }, code: { type: 'string', description: '技术点代码' }, detail: { type: 'string', description: '具体缺口' }, tri: { type: 'string', description: 'done | missing | unknown' }, nextAction: { type: 'string', description: '下一步动作' }, checkAt: { type: 'string', description: '检查时间 ISO 8601' }, concept: { type: 'string', description: '关联概念键' } }, run: runLedgerTool }))
  safeRegister(ctx, makeTool({ name: 'muse_plan', description: '个性化学习/科研计划：action=save 提交 JSON，action=get 读取。', parameters: { action: { type: 'string', description: 'save | get' }, id: { type: 'string', description: '更新已有计划时给 id' }, content: { type: 'string', description: '计划 JSON' } }, run: runPlanTool }))
  safeRegister(ctx, makeTool({ name: 'muse_reminder', description: '条件化提醒：action=check 输出到期项与未知堆积追问；action=schedule 生成 schedule_create 的 prompt/rrule 建议。', parameters: { action: { type: 'string', description: 'check | schedule' }, now: { type: 'string', description: '模拟当前时间 ISO' } }, run: runReminderTool }))
  safeRegister(ctx, makeTool({ name: 'muse_literature', description: '文献核验：逐行标题或 DOI，真查 Crossref/PubMed；仅重合度达标才 verified 并入库，查不到如实列出。', parameters: { queries: { type: 'string', description: '每行一个标题或 DOI' } }, run: runLiteratureTool }))
  safeRegister(ctx, makeTool({ name: 'muse_analysis', description: '精细分析：action=paper 论文精读必答清单（按画像调深度）；action=stats 统计检验推荐与实现。', parameters: { action: { type: 'string', description: 'paper | stats' }, title: { type: 'string', description: '标题/主题' }, notes: { type: 'string', description: '笔记或相对文件名' }, fromFile: { type: 'string', description: 'true 时 notes 视为记忆库文件名' }, design: { type: 'string', description: 'stats 研究设计' }, outcome: { type: 'string', description: 'stats 结局变量' }, sample: { type: 'string', description: 'stats 样本量' } }, run: runAnalysisTool }))
  safeRegister(ctx, makeTool({ name: 'muse_draft', description: '研究梳理与初稿：action=outline 大纲；action=assemble 写 draft.md；action=polish 投稿前自检。', parameters: { action: { type: 'string', description: 'outline | assemble | polish' } }, run: runDraftTool }))
  safeRegister(ctx, makeTool({ name: 'muse_inspire', description: '启发与上手：action=howto/reproduce/ideas。', parameters: { topic: { type: 'string', description: '主题' }, mode: { type: 'string', description: 'howto | reproduce | ideas' } }, run: runInspireTool }))
}