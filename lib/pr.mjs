// Open one pull request per verified fix. We never push to a team's repo: the branch goes to a fork
// under the token's account, unless the repo already belongs to that account.
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { writeFile, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { query, insert, flush } from "./db.mjs"

const run = promisify(execFile)
const GH = "https://api.github.com"
const GIT_ID = ["-c", "user.name=Patchwork", "-c", "user.email=desk@localhost"]

function token() {
  const t = process.env.GITHUB_TOKEN
  if (!t) throw new Error("GITHUB_TOKEN is not set on the server, so pull requests are off. Download the patch instead.")
  return t
}
async function gh(method, p, body) {
  const res = await fetch(GH + p, { method, headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "patchwork-desk" }, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${data.message || p}`)
  return data
}

export async function openPullRequests({ scan, dir, base_url, only = null, log = console.log }) {
  const m = scan.repo_url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  if (!m) throw new Error("Pull requests need a GitHub repo")
  const [, owner, repo] = m
  const me = (await gh("GET", "/user")).login
  const upstream = await gh("GET", `/repos/${owner}/${repo}`)
  const baseBranch = upstream.default_branch
  let targetOwner = me
  if (owner.toLowerCase() !== me.toLowerCase()) {
    const fork = await gh("POST", `/repos/${owner}/${repo}/forks`)
    targetOwner = fork.owner.login
    await new Promise((r) => setTimeout(r, 2500)) // forks are created asynchronously
  }
  const { rows: fixes } = await query(`SELECT f.fix_id AS fix_id, f.finding_id AS finding_id, f.explanation AS explanation, f.diff AS diff, f.memory_hit AS memory_hit, f.new_issues AS new_issues, f.syntax_ok AS syntax_ok, f.latency_ms AS latency_ms, f.session_url AS session_url,
      fi.path AS path, fi.line AS line, fi.rule_id AS rule_id, v.title AS title, v.severity AS severity, v.why AS why, v.session_url AS triage_session
    FROM fixes AS f INNER JOIN findings AS fi ON fi.finding_id = f.finding_id LEFT JOIN verdicts AS v ON v.finding_id = f.finding_id
    WHERE f.scan_id = {scan_id:String} AND f.status = 'verified' ORDER BY f.ts`, { scan_id: scan.scan_id })
  const { stdout: baseSha } = await run("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: dir })
  const base = baseSha.trim()
  const results = []
  const tmp = await mkdtemp(path.join(os.tmpdir(), "patchwork-pr-"))
  const remote = `https://x-access-token:${token()}@github.com/${targetOwner}/${repo}.git`
  try {
    for (const f of fixes) {
      if (only && f.fix_id !== only) continue
      const short = f.fix_id.slice(0, 8)
      const branch = `patchwork/${f.rule_id.split(".").pop().replace(/[^\w-]/g, "-").slice(0, 40)}-${short}`
      try {
        await run("git", ["checkout", "-q", "-B", branch, base], { cwd: dir })
        const patchFile = path.join(tmp, `${short}.patch`)
        await writeFile(patchFile, f.diff.endsWith("\n") ? f.diff : f.diff + "\n")
        await run("git", ["apply", "--index", patchFile], { cwd: dir })
        await run("git", [...GIT_ID, "commit", "-qm", `fix: ${f.title || f.rule_id.split(".").pop()} in ${f.path}\n\n${f.explanation}\n\nVerified by Semgrep rescan. Patchwork.`], { cwd: dir })
        await run("git", ["push", "-q", "--force", remote, `${branch}:${branch}`], { cwd: dir, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
        const body = [
          `**${f.title || f.rule_id}** · ${f.severity || ""} · \`${f.path}:${f.line}\``,
          "",
          f.why || "",
          "",
          `**What changed:** ${f.explanation}`,
          "",
          "**Proof (verified by rescan, not guaranteed):**",
          `- Semgrep rule \`${f.rule_id}\` no longer fires on this file after the change`,
          `- New Semgrep findings introduced: ${f.new_issues}`,
          `- Syntax check: ${f.syntax_ok ? "passed" : "not checked for this file type"}`,
          `- Found to fixed: ${(f.latency_ms / 1000).toFixed(1)} s${f.memory_hit ? " (guided by a fix already verified in the room)" : ""}`,
          "",
          f.session_url ? `Fix session on Guild: ${f.session_url}` : "",
          f.triage_session ? `Triage session on Guild: ${f.triage_session}` : "",
          "",
          "A rescan proves the scanner no longer flags the code, not that the app behaves the same. Please read the diff.",
          /secret|key|token|password/i.test(f.rule_id) ? "\n**Rotate the key.** The old value is still in git history." : "",
          "",
          `Opened by Patchwork at the Cyberdefense Hackathon. Report: ${base_url}`,
        ].join("\n")
        let pr
        try {
          pr = await gh("POST", `/repos/${owner}/${repo}/pulls`, { title: `Fix: ${f.title || f.rule_id.split(".").pop()} (${f.path})`, head: `${targetOwner}:${branch}`, base: baseBranch, body, maintainer_can_modify: true })
        } catch (e) {
          if (!/already exists/i.test(e.message)) throw e
          const list = await gh("GET", `/repos/${owner}/${repo}/pulls?head=${targetOwner}:${branch}&state=open`)
          pr = list[0] || { html_url: "" }
        }
        insert("pipeline_events", { scan_id: scan.scan_id, team: scan.team, stage: "pr", detail: `${f.fix_id} ${pr.html_url} ${f.path}:${f.line}`, duration_ms: 0 })
        results.push({ fix_id: f.fix_id, path: f.path, line: f.line, url: pr.html_url, ok: true })
        log(`[pr] ${pr.html_url}`)
      } catch (e) {
        results.push({ fix_id: f.fix_id, path: f.path, line: f.line, ok: false, error: String(e.message).slice(0, 200) })
        log(`[pr] failed for ${f.path}:${f.line}: ${e.message}`)
      }
    }
  } finally {
    await run("git", ["checkout", "-q", "-f", "master"], { cwd: dir }).catch(() => run("git", ["checkout", "-q", "-f", "main"], { cwd: dir }).catch(() => {}))
    await rm(tmp, { recursive: true, force: true })
    await flush()
  }
  return results
}
