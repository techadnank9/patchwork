// Patchwork pipeline for one scan. Also a CLI:
//   node --env-file=.env worker.mjs <repo_url> "<team>" [--no-agents] [--no-fix] [--source fixture] [--public]
import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { insert, insertNow, flush, query, close } from "./lib/db.mjs"
import { cloneRepo, readRepoFile, snippetAround, repoSlug, validateRepoUrl, WORK_DIR } from "./lib/repo.mjs"
import { scan, filterAndRank } from "./lib/semgrep.mjs"
import { redact } from "./lib/redact.mjs"
import { runAgent, parseVerdict, parsePlan } from "./lib/agents.mjs"
import { fixAndVerify } from "./lib/verify.mjs"

const run = promisify(execFile)
const env = (k, d) => (process.env[k] ? Number(process.env[k]) : d)

export async function runScan({ scan_id, team, repo_url, is_public = 0, source = "room", agents = true, fix = true, local_dir = null, log = console.log }) {
  const repo = local_dir ? repo_url : validateRepoUrl(repo_url)
  const totals = { findings: 0, triaged: 0, real: 0, noise: 0, verified: 0, failed: 0, needs_human: 0 }
  const event = (stage, detail, duration_ms = 0) => {
    insert("pipeline_events", { scan_id, team, stage, detail, duration_ms: Math.round(duration_ms) })
    log(`[${scan_id.slice(0, 8)}] ${stage.padEnd(10)} ${detail}${duration_ms ? ` (${(duration_ms / 1000).toFixed(1)} s)` : ""}`)
  }
  let dir = null
  try {
    // Clone
    let t = Date.now()
    event("cloning", `cloning ${local_dir ? repo : repoSlug(repo)}`)
    const clone = local_dir ? await importLocal(local_dir, scan_id) : await cloneRepo(repo, scan_id)
    dir = clone.dir
    event("cloning", `cloned ${local_dir ? repo : repoSlug(repo)} at ${clone.sha.slice(0, 7)}, ${Math.round(clone.bytes / 1024)} KB`, Date.now() - t)

    // Scan
    t = Date.now()
    event("scanning", "running Semgrep")
    const result = await scan(dir, ".")
    const ranked = filterAndRank(result.results)
    event("scanning", `${ranked.length} findings`, Date.now() - t)

    // Store every finding with a redacted snippet
    const findings = []
    for (const r of ranked) {
      let snippet = ""
      try {
        snippet = redact(snippetAround(await readRepoFile(dir, r.path), r.line))
      } catch (e) {
        snippet = `(could not read ${r.path}: ${e.message})`
      }
      const finding = { finding_id: randomUUID(), scan_id, ...r, message: redact(r.message), snippet }
      findings.push(finding)
      insert("findings", finding)
    }
    totals.findings = findings.length
    await flush()

    if (!agents || findings.length === 0) {
      event("done", summary(totals))
      return { scan_id, dir, sha: clone.sha, totals, findings, verdicts: [], plan: null, fixes: [] }
    }

    // Triage
    t = Date.now()
    const toTriage = findings.slice(0, env("MAX_TRIAGE_PER_REPO", 15))
    event("triaging", `triaging ${toTriage.length} of ${findings.length}`)
    const verdicts = []
    let done = 0
    await parallel(toTriage, env("TRIAGE_CONCURRENCY", 4), async (f) => {
      try {
        const res = await runAgent("triage", {
          rule_id: f.rule_id, semgrep_severity: f.semgrep_severity, message: f.message,
          path: f.path, line: f.line, language: f.language, snippet: f.snippet,
        })
        const v = parseVerdict(res.events)
        if (!v) {
          log(`[triage] no verdict parsed for ${f.path}:${f.line}; events:`, JSON.stringify(res.events).slice(0, 1500))
          return
        }
        const row = {
          finding_id: f.finding_id, scan_id,
          verdict: v.verdict, severity: clean(v.severity, ["high", "medium", "low"], "low"),
          bug_class: clean(v.bug_class, ["injection", "secrets", "auth", "packages", "crypto", "other"], "other"),
          title: str(v.title, 120), why: redact(str(v.why, 600)), fix_hint: redact(str(v.fix_hint, 400)),
          confidence: Number(v.confidence) || 0, backend: res.backend, session_url: res.session_url || "", latency_ms: res.latency_ms,
        }
        verdicts.push(row)
        insert("verdicts", row)
      } catch (e) {
        log(`[triage] failed for ${f.path}:${f.line}: ${e.message}`)
      } finally {
        done++
        event("triaging", `triaged ${done} of ${toTriage.length}`)
      }
    })
    totals.triaged = verdicts.length
    totals.real = verdicts.filter((v) => v.verdict === "real").length
    totals.noise = verdicts.filter((v) => v.verdict === "noise").length
    event("triaging", `${totals.real} real, ${totals.noise} noise`, Date.now() - t)
    await flush()

    // Plan
    let plan = null
    const real = verdicts.filter((v) => v.verdict === "real")
    const byId = new Map(findings.map((f) => [f.finding_id, f]))
    if (real.length > 0) {
      t = Date.now()
      event("planning", `planning ${real.length} issues`)
      try {
        const issues = real.map((v) => {
          const f = byId.get(v.finding_id)
          return { finding_id: v.finding_id, rule_id: f.rule_id, path: f.path, line: f.line, severity: v.severity, bug_class: v.bug_class, title: v.title, why: v.why, fix_hint: v.fix_hint }
        })
        const res = await runAgent("planner", { team, repo: local_dir ? repo : repoSlug(repo), findings_json: JSON.stringify(issues) })
        plan = parsePlan(res.events)
        if (!plan) log("[plan] no plan parsed; events:", JSON.stringify(res.events).slice(0, 1500))
        else insert("plans", { scan_id, plan_json: JSON.stringify(plan), session_url: res.session_url || "", latency_ms: res.latency_ms })
        event("planning", plan ? `${plan.steps.length} steps` : "plan not parsed", Date.now() - t)
      } catch (e) {
        event("planning", `planner failed: ${e.message.slice(0, 120)}`, Date.now() - t)
      }
    }

    // Fix and verify, in plan order
    const fixes = []
    if (fix && real.length > 0) {
      const order = []
      const seen = new Set()
      for (const step of plan?.steps || []) for (const id of step.finding_ids || []) if (byId.has(id) && !seen.has(id)) { seen.add(id); order.push(id) }
      for (const v of real) if (!seen.has(v.finding_id)) { seen.add(v.finding_id); order.push(v.finding_id) }
      const realById = new Map(real.map((v) => [v.finding_id, v]))
      const targets = order.filter((id) => realById.has(id)).slice(0, env("MAX_FIX_PER_REPO", 5))
      t = Date.now()
      event("fixing", `fixing up to ${targets.length} issues`)
      for (const id of targets) {
        const f = byId.get(id)
        const v = realById.get(id)
        const t2 = Date.now()
        event("fixing", `fixing ${f.path}:${f.line}`)
        try {
          const outcome = await fixAndVerify({ dir, finding: f, verdict: v, scan_id, log })
          if (outcome) {
            fixes.push(outcome)
            totals[outcome.status === "verified" ? "verified" : outcome.status === "failed" ? "failed" : "needs_human"]++
            event("verifying", `${f.path}:${f.line} ${outcome.status}${outcome.memory_hit ? " (memory assisted)" : ""}`, Date.now() - t2)
          } else {
            event("verifying", `${f.path}:${f.line} already gone`, Date.now() - t2)
          }
        } catch (e) {
          event("verifying", `${f.path}:${f.line} error: ${e.message.slice(0, 120)}`, Date.now() - t2)
        }
      }
      event("fixing", `${totals.verified} verified`, Date.now() - t)
    }

    event("done", summary(totals))
    await flush()
    return { scan_id, dir, sha: clone.sha, totals, findings, verdicts, plan, fixes }
  } catch (e) {
    event("error", redact(String(e.message || e)).slice(0, 400))
    await flush()
    throw e
  }
}

// Test fixtures live in this repo, not on GitHub. Copy one into work/ and give it a git history so diffs work.
async function importLocal(src, scan_id) {
  const dir = path.join(WORK_DIR, scan_id)
  await run("mkdir", ["-p", WORK_DIR])
  await run("cp", ["-R", src, dir])
  await run("git", ["init", "-q"], { cwd: dir })
  await run("git", ["-c", "user.name=Patchwork", "-c", "user.email=desk@localhost", "add", "-A"], { cwd: dir })
  await run("git", ["-c", "user.name=Patchwork", "-c", "user.email=desk@localhost", "commit", "-qm", "fixture"], { cwd: dir })
  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: dir })
  return { dir, sha: stdout.trim(), bytes: 0 }
}

function summary(t) {
  const parts = [`${t.findings} finding${t.findings === 1 ? "" : "s"}`]
  if (t.triaged) parts.push(`${t.real} real`, `${t.noise} noise`)
  if (t.verified) parts.push(`${t.verified} verified fix${t.verified === 1 ? "" : "es"}`)
  if (t.needs_human) parts.push(`${t.needs_human} need a human`)
  return parts.join(", ")
}

function clean(value, allowed, fallback) {
  const v = String(value || "").toLowerCase()
  return allowed.includes(v) ? v : fallback
}
function str(v, max) {
  return String(v ?? "").slice(0, max)
}
async function parallel(items, limit, fn) {
  const queue = [...items]
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length) await fn(queue.shift())
  })
  await Promise.all(workers)
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2)
  const flags = new Set(args.filter((a) => a.startsWith("--")))
  const positional = args.filter((a, i) => !a.startsWith("--") && !["--source", "--local"].includes(args[i - 1]))
  const sourceIdx = args.indexOf("--source")
  const localIdx = args.indexOf("--local")
  const local_dir = localIdx >= 0 ? path.resolve(args[localIdx + 1]) : null
  const source = sourceIdx >= 0 ? args[sourceIdx + 1] : local_dir ? "fixture" : "room"
  const repo_url = local_dir ? `fixture://${path.basename(local_dir)}` : positional[0]
  const team = (local_dir ? positional[0] : positional[1]) || "Me"
  if (!repo_url) {
    console.error('usage: node --env-file=.env worker.mjs <repo_url> "<team>" [--no-agents] [--no-fix] [--source fixture] [--public]  |  --local fixtures/vuln-app "<team>"')
    process.exit(1)
  }
  const scan_id = randomUUID()
  const token = randomUUID().replace(/-/g, "").slice(0, 32)
  await insertNow("scans", { scan_id, token, team, repo_url, is_public: flags.has("--public") ? 1 : 0, source })
  console.log(`scan_id ${scan_id}`)
  try {
    const out = await runScan({ scan_id, team, repo_url, is_public: flags.has("--public") ? 1 : 0, source, local_dir, agents: !flags.has("--no-agents"), fix: !flags.has("--no-fix") })
    console.log("totals", out.totals)
    const { rows } = await query("SELECT count() AS n FROM findings WHERE scan_id = {scan_id:String}", { scan_id })
    console.log(`findings rows in ClickHouse for this scan: ${rows[0].n}`)
    console.log(`report: ${process.env.PUBLIC_BASE_URL || "http://localhost:3000"}/report.html?scan=${scan_id}&t=${token}`)
  } finally {
    await close()
  }
}
