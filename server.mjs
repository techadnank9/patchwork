// Patchwork server: Express, static public/, in-memory FIFO queue, JSON API.
import express from "express"
import { randomBytes, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { insertNow, query, flush } from "./lib/db.mjs"
import { validateRepoUrl, WORK_DIR } from "./lib/repo.mjs"
import { runScan } from "./worker.mjs"

const run = promisify(execFile)
const PORT = Number(process.env.PORT || 3000)
const BASE = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "")
const SCAN_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY || 2)
const SQL = await loadQueries()

const app = express()
app.disable("x-powered-by")
app.set("trust proxy", 1)
app.use(express.json({ limit: "16kb" }))
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Referrer-Policy", "no-referrer")
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'")
  next()
})
app.use(express.static("public", { extensions: ["html"] }))

// ---------- queue ----------
const queue = []
const active = new Map() // repo_url -> scan_id
const stageOf = new Map() // scan_id -> { stage, detail }
let running = 0

function enqueue(job) {
  queue.push(job)
  stageOf.set(job.scan_id, { stage: "queued", detail: `position ${queue.length}` })
  pump()
}
function pump() {
  while (running < SCAN_CONCURRENCY && queue.length) {
    const job = queue.shift()
    running++
    active.set(job.repo_url, job.scan_id)
    runScan({ ...job, log: (...a) => console.log(...a) })
      .catch((e) => console.error(`[scan ${job.scan_id.slice(0, 8)}] failed: ${e.message}`))
      .finally(() => {
        running--
        active.delete(job.repo_url)
        pump()
      })
  }
}

// ---------- rate limit: 3 scans per minute per IP ----------
const hits = new Map()
function limited(ip) {
  const now = Date.now()
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000)
  if (list.length >= 3) return true
  list.push(now)
  hits.set(ip, list)
  return false
}

// ---------- API ----------
app.post("/api/scans", async (req, res) => {
  try {
    if (limited(req.ip)) return res.status(429).json({ error: "Three scans per minute per device. Try again shortly." })
    const team = String(req.body?.team || "").trim().slice(0, 60)
    if (!team) return res.status(400).json({ error: "Team name is required" })
    const repo_url = validateRepoUrl(String(req.body?.repo_url || ""))
    const is_public = req.body?.is_public ? 1 : 0
    if (active.has(repo_url) || queue.some((j) => j.repo_url === repo_url)) {
      return res.status(409).json({ error: "That repo is already being scanned. Wait for it to finish." })
    }
    const scan_id = randomUUID()
    const token = randomBytes(16).toString("hex")
    await insertNow("scans", { scan_id, token, team, repo_url, is_public, source: "room" })
    enqueue({ scan_id, team, repo_url, is_public, source: "room" })
    res.json({ scan_id, report_url: `${BASE}/report.html?scan=${scan_id}&t=${token}` })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

let boardCache = { at: 0, body: null }
app.get("/api/board", async (req, res) => {
  const sample = req.query.sample === "1"
  if (!sample && boardCache.body && Date.now() - boardCache.at < 1000) return res.json(boardCache.body)
  try {
    const source = sample ? "sample" : "room"
    const started = performance.now()
    const [cells, totals, variants, headline, speed, feed, counts] = await Promise.all([
      query(withSource(SQL.Q1, source)),
      query(withSource(SQL.Q2, source)),
      query(withSource(SQL.Q3, source)),
      query(withSource(SQL.Q4, source)),
      query(withSource(SQL.Q5, source)),
      query(withSource(SQL.Q6, source)),
      query("SELECT (SELECT count() FROM scans) + (SELECT count() FROM pipeline_events) + (SELECT count() FROM findings) + (SELECT count() FROM verdicts) + (SELECT count() FROM plans) + (SELECT count() FROM fixes) + (SELECT count() FROM fix_memory) AS rows_total"),
    ])
    const body = {
      cells: cells.rows, totals: totals.rows[0] || {}, variants: variants.rows, headline: headline.rows[0] || null,
      speed: speed.rows[0] || {}, feed: feed.rows, rows_total: Number(counts.rows[0]?.rows_total || 0),
      query_ms: Math.round((performance.now() - started) * 10) / 10,
      queries_ms: { cells: cells.query_ms, totals: totals.query_ms, variants: variants.query_ms, headline: headline.query_ms, speed: speed.query_ms, feed: feed.query_ms },
      sample, queue: { waiting: queue.length, running },
      generated_at: new Date().toISOString(),
    }
    if (!sample) boardCache = { at: Date.now(), body }
    res.json(body)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get("/api/history", async (req, res) => {
  try {
    const started = performance.now()
    const { rows } = await query(SQL.H1)
    res.json({ scans: rows, query_ms: Math.round((performance.now() - started) * 10) / 10 })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

async function authScan(req, res) {
  const scan_id = String(req.params.id || "")
  const t = String(req.query.t || "")
  if (!/^[0-9a-f-]{36}$/.test(scan_id) || !/^[0-9a-f]{32}$/.test(t)) return null
  const { rows } = await query("SELECT scan_id, token, team, repo_url, is_public, source, created_at FROM scans WHERE scan_id = {scan_id:String} LIMIT 1", { scan_id })
  const scan = rows[0]
  if (!scan || scan.token !== t) return null
  delete scan.token
  return scan
}

app.get("/api/scans/:id", async (req, res) => {
  try {
    const scan = await authScan(req, res)
    if (!scan) return res.status(404).json({ error: "Not found" })
    const scan_id = scan.scan_id
    const [events, plan, issues, fixes, variants] = await Promise.all([
      query("SELECT ts, stage, detail, duration_ms FROM pipeline_events WHERE scan_id = {scan_id:String} ORDER BY ts DESC LIMIT 50", { scan_id }),
      query("SELECT plan_json, session_url, latency_ms FROM plans WHERE scan_id = {scan_id:String} ORDER BY ts DESC LIMIT 1", { scan_id }),
      query(SQL.Q8, { scan_id }),
      query("SELECT fix_id, finding_id, attempt, status, memory_hit, explanation, diff, syntax_ok, finding_gone, new_issues, error, session_url, latency_ms, ts FROM fixes WHERE scan_id = {scan_id:String} ORDER BY ts DESC", { scan_id }),
      query(withSource(SQL.Q3, scan.source)),
    ])
    const latestFix = new Map()
    for (const f of fixes.rows) if (!latestFix.has(f.finding_id)) latestFix.set(f.finding_id, f)
    const findingsCount = (await query("SELECT count() AS n FROM findings WHERE scan_id = {scan_id:String}", { scan_id })).rows[0]?.n || 0
    const variantByRule = new Map(variants.rows.map((v) => [v.rule_id, v]))
    const verifiedPaths = new Set(issues.rows.filter((i) => latestFix.get(i.finding_id)?.status === "verified").map((i) => i.path))
    const all = issues.rows.map((i) => {
      const fix = latestFix.get(i.finding_id) || null
      // A sibling patch in the same file can make this finding vanish before the fixer reaches it.
      const covered = !fix && i.verdict === "real" && verifiedPaths.has(i.path) ? 1 : 0
      return { ...i, fix, covered, variant: variantByRule.get(i.rule_id) || null }
    })
    const live = stageOf.get(scan_id)
    const latest = events.rows[0]
    let planObj = null
    try { planObj = plan.rows[0] ? JSON.parse(plan.rows[0].plan_json) : null } catch {}
    res.json({
      scan,
      status: latest ? { stage: latest.stage, detail: latest.detail, ts: latest.ts } : live || { stage: "queued", detail: "" },
      events: events.rows,
      plan: planObj,
      plan_session: plan.rows[0]?.session_url || "",
      issues: all.filter((i) => i.verdict === "real"),
      noise: all.filter((i) => i.verdict === "noise"),
      findings_total: Number(findingsCount),
      patch_available: fixes.rows.some((f) => f.status === "verified"),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Repo map: top-level layout of our clone plus every file Semgrep flagged, for the diagram on the report.
app.get("/api/scans/:id/tree", async (req, res) => {
  try {
    const scan = await authScan(req, res)
    if (!scan) return res.status(404).json({ error: "Not found" })
    const dir = path.join(WORK_DIR, scan.scan_id)
    const { readdir, stat } = await import("node:fs/promises")
    const SKIP = new Set(["node_modules", ".git", "vendor", "dist", "build", ".next", "__pycache__", ".venv", "venv"])
    const dirs = []
    let rootFiles = 0
    try {
      for (const name of await readdir(dir)) {
        if (SKIP.has(name)) continue
        const st = await stat(path.join(dir, name))
        if (st.isDirectory()) {
          let files = 0, subdirs = 0
          const langs = {}
          const walk = async (d, depth) => {
            for (const n of await readdir(d)) {
              if (SKIP.has(n)) continue
              const p2 = path.join(d, n)
              const s2 = await stat(p2)
              if (s2.isDirectory()) { subdirs++; if (depth < 3) await walk(p2, depth + 1) }
              else { files++; const ext = n.includes(".") ? n.split(".").pop().toLowerCase() : "other"; langs[ext] = (langs[ext] || 0) + 1 }
            }
          }
          await walk(path.join(dir, name), 1)
          dirs.push({ name, files, subdirs, langs })
        } else rootFiles++
      }
    } catch (e) {
      return res.json({ available: false, reason: "clone no longer on disk", flagged: [] })
    }
    const { rows } = await query(`SELECT f.path AS path, f.rule_id AS rule_id, v.verdict AS verdict, v.severity AS severity, v.bug_class AS bug_class
      FROM findings AS f LEFT JOIN verdicts AS v ON v.finding_id = f.finding_id WHERE f.scan_id = {scan_id:String}`, { scan_id: scan.scan_id })
    const flagged = new Map()
    for (const r of rows) {
      const cur = flagged.get(r.path) || { path: r.path, findings: 0, real: 0, noise: 0, pending: 0, worst: "", classes: new Set() }
      cur.findings++
      if (r.verdict === "real") { cur.real++; cur.classes.add(r.bug_class); if (r.severity === "high" || (!cur.worst && r.severity)) cur.worst = r.severity === "high" ? "high" : cur.worst || r.severity }
      else if (r.verdict === "noise") cur.noise++
      else cur.pending++
      flagged.set(r.path, cur)
    }
    res.json({ available: true, repo: scan.repo_url.replace("https://github.com/", "").replace(/^fixture:\/\//, ""), root_files: rootFiles, dirs: dirs.sort((a, b) => b.files - a.files).slice(0, 14), flagged: [...flagged.values()].map((f) => ({ ...f, classes: [...f.classes] })) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get("/api/scans/:id/patch", async (req, res) => {
  try {
    const scan = await authScan(req, res)
    if (!scan) return res.status(404).type("text/plain").send("Not found")
    const dir = path.join(WORK_DIR, scan.scan_id)
    let patch = ""
    try {
      const { stdout: first } = await run("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: dir })
      patch = (await run("git", ["diff", first.trim(), "HEAD"], { cwd: dir, maxBuffer: 16 * 1024 * 1024 })).stdout
    } catch {
      // clone gone: rebuild from stored diffs
      const { rows } = await query("SELECT diff FROM fixes WHERE scan_id = {scan_id:String} AND status = 'verified' ORDER BY ts", { scan_id: scan.scan_id })
      patch = rows.map((r) => r.diff).join("\n")
    }
    res.setHeader("Content-Disposition", 'attachment; filename="patchwork.patch"')
    res.type("text/plain").send(patch)
  } catch (e) {
    res.status(500).type("text/plain").send(e.message)
  }
})

app.post("/api/scans/:id/rescan", async (req, res) => {
  try {
    const scan = await authScan(req, res)
    if (!scan) return res.status(404).json({ error: "Not found" })
    if (active.has(scan.repo_url)) return res.status(409).json({ error: "Already scanning" })
    const scan_id = randomUUID()
    const token = randomBytes(16).toString("hex")
    await insertNow("scans", { scan_id, token, team: scan.team, repo_url: scan.repo_url, is_public: scan.is_public, source: scan.source })
    enqueue({ scan_id, team: scan.team, repo_url: scan.repo_url, is_public: scan.is_public, source: scan.source })
    res.json({ scan_id, report_url: `${BASE}/report.html?scan=${scan_id}&t=${token}` })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get("/api/qr", async (req, res) => {
  const QRCode = (await import("qrcode")).default
  const svg = await QRCode.toString(`${BASE}/join.html`, { type: "svg", margin: 1, color: { dark: "#f4f1ea", light: "#0000" } })
  res.type("image/svg+xml").send(svg)
})

app.get("/api/config", (req, res) => res.json({ base: BASE }))

// Every room project (newest scan per repo). Opted-in teams include their confirmed issues
// (title, class, severity, path, fix status). Others expose counts only.
app.get("/api/projects", async (req, res) => {
  try {
    const started = performance.now()
    const { rows: scans } = await query(`SELECT s.scan_id AS scan_id, s.team AS team, s.repo_url AS repo_url, s.is_public AS is_public, s.created_at AS created_at
      FROM scans AS s WHERE s.scan_id IN (SELECT scan_id FROM latest_room_scans) ORDER BY s.created_at DESC`)
    const ids = scans.map((x) => x.scan_id)
    const { rows: issues } = ids.length ? await query(`SELECT f.scan_id AS scan_id, f.finding_id AS finding_id, f.rule_id AS rule_id, f.path AS path, f.line AS line,
        v.verdict AS verdict, v.severity AS severity, v.bug_class AS bug_class, v.title AS title, v.why AS why, v.fix_hint AS fix_hint
      FROM findings AS f INNER JOIN verdicts AS v ON v.finding_id = f.finding_id WHERE f.scan_id IN ({ids:Array(String)})`, { ids }) : { rows: [] }
    const { rows: fixes } = ids.length ? await query(`SELECT finding_id, argMax(status, ts) AS status, argMax(memory_hit, ts) AS memory_hit FROM fixes WHERE scan_id IN ({ids:Array(String)}) GROUP BY finding_id`, { ids }) : { rows: [] }
    const { rows: counts } = ids.length ? await query(`SELECT scan_id, count() AS findings FROM findings WHERE scan_id IN ({ids:Array(String)}) GROUP BY scan_id`, { ids }) : { rows: [] }
    const fixBy = new Map(fixes.map((f) => [f.finding_id, f]))
    const countBy = new Map(counts.map((c) => [c.scan_id, Number(c.findings)]))
    const projects = scans.map((sc) => {
      const mine = issues.filter((i) => i.scan_id === sc.scan_id)
      const real = mine.filter((i) => i.verdict === "real")
      const byClass = {}
      for (const i of real) byClass[i.bug_class] = (byClass[i.bug_class] || 0) + 1
      const bySev = { high: 0, medium: 0, low: 0 }
      for (const i of real) bySev[i.severity] = (bySev[i.severity] || 0) + 1
      const verified = real.filter((i) => fixBy.get(i.finding_id)?.status === "verified").length
      const base = { team: sc.is_public ? sc.team : "A team", is_public: Number(sc.is_public), repo: sc.is_public ? sc.repo_url.replace("https://github.com/", "") : "", created_at: sc.created_at,
        findings: countBy.get(sc.scan_id) || 0, real: real.length, noise: mine.length - real.length, verified, by_class: byClass, by_severity: bySev }
      if (!sc.is_public) return base
      return { ...base, issues: real.map((i) => ({ title: i.title, severity: i.severity, bug_class: i.bug_class, path: i.path, line: i.line, rule_id: i.rule_id, why: i.why, fix_hint: i.fix_hint, status: fixBy.get(i.finding_id)?.status || "", memory_hit: Number(fixBy.get(i.finding_id)?.memory_hit || 0) })) }
    })
    res.json({ projects, query_ms: Math.round((performance.now() - started) * 10) / 10 })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Landing page numbers: real room totals only, never sample rows.
app.get("/api/pulse", async (req, res) => {
  try {
    const [totals, speed, hist] = await Promise.all([query(SQL.Q2), query(SQL.Q5), query("SELECT count() AS scans FROM scans WHERE source = 'room'")])
    res.json({ ...totals.rows[0], median_fix_seconds: speed.rows[0]?.median_fix_seconds ?? null, scans: Number(hist.rows[0]?.scans || 0) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.listen(PORT, process.env.HOST || "127.0.0.1", () => console.log(`Patchwork on http://localhost:${PORT}  public: ${BASE}`))

process.on("SIGINT", async () => { await flush().catch(() => {}); process.exit(0) })

// ---------- helpers ----------
async function loadQueries() {
  const text = await readFile(new URL("./queries.sql", import.meta.url), "utf8")
  const out = {}
  for (const block of text.split(/\n(?=-- Q\d|-- H\d)/)) {
    const m = block.match(/^-- (Q\d|H\d)\./)
    if (!m) continue
    out[m[1]] = block.replace(/^--.*$/gm, "").trim().replace(/;\s*$/, "")
  }
  return out
}
// The board normally reads source = 'room'. With ?sample=1 it reads the seed rows instead.
function withSource(sql, source) {
  return source === "room" ? sql : sql.replaceAll("source = 'room'", `source = '${source}'`).replaceAll("latest_room_scans", `(SELECT argMax(scan_id, created_at) AS scan_id FROM scans WHERE source = '${source}' GROUP BY repo_url)`)
}
