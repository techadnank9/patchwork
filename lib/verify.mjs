// Apply one fix to OUR clone, then prove it: syntax check, Semgrep rescan, diff.
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { insert, query } from "./db.mjs"
import { safePath } from "./repo.mjs"
import { scan } from "./semgrep.mjs"
import { redact, MASK_MARK } from "./redact.mjs"
import { runAgent, parseFix } from "./agents.mjs"

const run = promisify(execFile)
const GIT_ID = ["-c", "user.name=Patchwork", "-c", "user.email=desk@localhost"]
const Q7 = "SELECT explanation, diff FROM fix_memory WHERE rule_id = {rule_id:String} ORDER BY ts DESC LIMIT 1"

export async function fixAndVerify({ dir, finding, verdict, scan_id, log = console.log }) {
  const file = await safePath(dir, finding.path)
  const rel = path.relative(dir, file)

  // Baseline: where is this rule in the file right now?
  const baseline = await scan(dir, rel, { timeoutMs: 120000 })
  const same = baseline.results.filter((r) => r.rule_id === finding.rule_id)
  if (same.length === 0) return null
  const target = same.reduce((a, b) => (Math.abs(b.line - finding.line) < Math.abs(a.line - finding.line) ? b : a))
  const baseCounts = countRules(baseline.results)

  // Room memory
  let prior_example = ""
  let memory_hit = 0
  try {
    const { rows } = await query(Q7, { rule_id: finding.rule_id })
    if (rows[0]?.diff) {
      prior_example = `Explanation: ${rows[0].explanation}\n${rows[0].diff}`.slice(0, 4000)
      memory_hit = 1
    }
  } catch (e) {
    log(`[memory] lookup failed: ${e.message}`)
  }

  let retry_error = ""
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now()
    const original = await readFile(file, "utf8")
    const lines = original.split("\n")
    const win = window(lines, target.line)
    const code = redact(win.text)
    const common = { fix_id: randomUUID(), finding_id: finding.finding_id, scan_id, attempt, memory_hit }
    let res, fix
    try {
      res = await runAgent("fixer", {
        rule_id: finding.rule_id, message: finding.message, path: finding.path, language: finding.language,
        target_line: target.line, fix_hint: verdict.fix_hint || "", code, prior_example, retry_error,
      })
      fix = parseFix(res.events)
    } catch (e) {
      return record({ ...common, status: attempt === 2 ? "needs_human" : "failed", error: `fixer call failed: ${e.message}`.slice(0, 400), session_url: res?.session_url || "", latency_ms: Date.now() - started }, attempt, () => (retry_error = "the fixer call failed"))
    }
    const base = { ...common, session_url: res.session_url || "", latency_ms: 0 }
    if (!fix) {
      log("[fix] nothing parsed; events:", JSON.stringify(res.events).slice(0, 1200))
      const r = record({ ...base, error: "fixer reply was not in the required format", latency_ms: Date.now() - started }, attempt)
      retry_error = "Your reply was not in the required format. Use START_LINE, END_LINE, EXPLANATION and the <<<REPLACEMENT block exactly."
      if (attempt === 2) return r
      continue
    }

    // Guards
    let reason = null
    if (fix.start_line < win.start || fix.end_line > win.end) reason = `line range ${fix.start_line}-${fix.end_line} is outside the window ${win.start}-${win.end}`
    else if (fix.end_line - fix.start_line + 1 > 120) reason = "replacement covers more than 120 lines"
    else if (fix.replacement.includes(MASK_MARK)) reason = "replacement contains a masked value"
    if (reason) {
      const r = record({ ...base, explanation: fix.explanation, error: reason, latency_ms: Date.now() - started }, attempt)
      retry_error = reason
      if (attempt === 2) return r
      continue
    }

    // Apply
    const replacement = fix.replacement.replace(/\r\n/g, "\n").split("\n")
    const patched = [...lines.slice(0, fix.start_line - 1), ...replacement, ...lines.slice(fix.end_line)]
    await writeFile(file, patched.join("\n"), "utf8")

    // Prove
    const syntax = await syntaxCheck(file)
    let finding_gone = 0
    let new_issues = 0
    let diff = ""
    let error = ""
    if (!syntax.ok) {
      error = `syntax check failed: ${syntax.error}`
    } else {
      const after = await scan(dir, rel, { timeoutMs: 120000 })
      const afterCounts = countRules(after.results)
      finding_gone = (afterCounts.get(finding.rule_id) || 0) < (baseCounts.get(finding.rule_id) || 0) ? 1 : 0
      for (const [rule, n] of afterCounts) if (n > (baseCounts.get(rule) || 0)) new_issues += n - (baseCounts.get(rule) || 0)
      if (!finding_gone) error = "Semgrep still flags the same rule after the change"
      else if (new_issues > 0) error = `the change introduced ${new_issues} new finding(s)`
    }
    const latency_ms = Date.now() - started

    if (!error) {
      diff = (await run("git", ["diff", "--", rel], { cwd: dir, maxBuffer: 8 * 1024 * 1024 })).stdout
      diff = redact(diff)
      await run("git", [...GIT_ID, "commit", "-qam", `fix: ${finding.rule_id.split(".").pop()} in ${rel}`], { cwd: dir })
      const row = { ...base, status: "verified", explanation: redact(fix.explanation), diff, syntax_ok: syntax.checked ? 1 : 0, finding_gone, new_issues, error: syntax.checked ? "" : "syntax not checked", latency_ms }
      insert("fixes", row)
      insert("fix_memory", { rule_id: finding.rule_id, language: finding.language, explanation: row.explanation, diff, from_scan_id: scan_id })
      log(`[fix] verified ${rel}:${target.line} in ${(latency_ms / 1000).toFixed(1)} s`)
      return { ...row, syntax_checked: syntax.checked }
    }

    await run("git", ["checkout", "--", rel], { cwd: dir })
    const r = record({ ...base, explanation: redact(fix.explanation), syntax_ok: syntax.ok ? 1 : 0, finding_gone, new_issues, error, latency_ms }, attempt)
    retry_error = error
    if (attempt === 2) return r
  }
}

function record(row, attempt, after) {
  const status = attempt === 2 ? "needs_human" : "failed"
  const full = { status, explanation: "", diff: "", syntax_ok: 0, finding_gone: 0, new_issues: 0, error: "", ...row, status: row.status || status }
  insert("fixes", full)
  after?.()
  return full
}

function window(lines, line) {
  let start = 1
  let end = lines.length
  if (lines.length > 300) {
    start = Math.max(1, line - 60)
    end = Math.min(lines.length, line + 60)
  }
  const text = []
  for (let n = start; n <= end; n++) text.push(`${n}\t${lines[n - 1]}`)
  return { start, end, text: text.join("\n") }
}

function countRules(results) {
  const m = new Map()
  for (const r of results) m.set(r.rule_id, (m.get(r.rule_id) || 0) + 1)
  return m
}

async function syntaxCheck(file) {
  const ext = path.extname(file).toLowerCase()
  try {
    if (ext === ".py") {
      await run("python3", ["-c", "import ast,sys; ast.parse(open(sys.argv[1]).read())", file], { timeout: 15000 })
      return { ok: true, checked: true }
    }
    if ([".js", ".mjs", ".cjs"].includes(ext)) {
      await run("node", ["--check", file], { timeout: 15000 })
      return { ok: true, checked: true }
    }
    if (ext === ".json") {
      JSON.parse(await readFile(file, "utf8"))
      return { ok: true, checked: true }
    }
    return { ok: true, checked: false }
  } catch (e) {
    return { ok: false, checked: true, error: String(e.stderr || e.message).split("\n").slice(-3).join(" ").slice(0, 300) }
  }
}
