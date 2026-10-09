// Writes source = 'sample' rows so the UI can be built before real scans exist.
// The board hides them unless ?sample=1 is set, and then shows a "Sample data" banner.
//   node --env-file=.env scripts/seed-sample.mjs
import { randomUUID } from "node:crypto"
import { insert, flush, close } from "../lib/db.mjs"

const teams = [
  ["Night Owls", "https://github.com/sample/night-owls", [["injection", "high", 3, 2], ["secrets", "high", 1, 1], ["auth", "medium", 2, 0]]],
  ["Blue Shift", "https://github.com/sample/blue-shift", [["injection", "medium", 2, 2], ["packages", "low", 1, 0]]],
  ["Pixel Raiders", "https://github.com/sample/pixel-raiders", [["secrets", "high", 2, 2], ["crypto", "medium", 1, 1], ["other", "low", 1, 0]]],
  ["Tiny Rockets", "https://github.com/sample/tiny-rockets", [["auth", "high", 1, 0]]],
]
const RULES = { injection: "python.flask.security.injection.tainted-sql-string", secrets: "generic.secrets.security.detected-stripe-api-key", auth: "javascript.express.security.audit.express-check-csurf-middleware-usage", packages: "javascript.lang.security.audit.detect-child-process", crypto: "python.cryptography.security.insecure-hash-algorithm-md5", other: "javascript.lang.security.audit.path-traversal" }
const TITLES = { injection: "SQL built by string concatenation", secrets: "Live Stripe key in source", auth: "Missing login check on admin route", packages: "Child process from user input", crypto: "MD5 used for password hashing", other: "Path traversal in file download" }
for (const [team, repo_url, cells] of teams) {
  const scan_id = randomUUID()
  insert("scans", { scan_id, token: randomUUID().replace(/-/g, ""), team, repo_url, is_public: 1, source: "sample" })
  const stages = ["cloning", "scanning", "triaging", "planning", "fixing", "done"]
  stages.forEach((stage, i) => insert("pipeline_events", { scan_id, team, stage, detail: stage === "scanning" ? "9 findings" : stage === "triaging" ? "6 real, 3 noise" : stage === "done" ? "finished" : `${stage}…`, duration_ms: 1200 * (i + 1) }))
  let n = 0
  for (const [bug_class, severity, real, fixed] of cells) {
    for (let k = 0; k < real; k++) {
      const finding_id = randomUUID()
      insert("findings", { finding_id, scan_id, rule_id: RULES[bug_class], path: `src/${bug_class}_${k}.py`, line: 40 + k, end_line: 41 + k, language: "python", semgrep_severity: "ERROR", message: "Sample finding", snippet: "40  rows = conn.execute(\"SELECT * FROM t WHERE x = '\" + q + \"'\")" })
      insert("verdicts", { finding_id, scan_id, verdict: "real", severity, bug_class, title: TITLES[bug_class], why: "Sample explanation of what can go wrong.", fix_hint: "Sample hint.", confidence: 0.9, backend: "guild", session_url: "", latency_ms: 4000 })
      if (k < fixed) insert("fixes", { fix_id: randomUUID(), finding_id, scan_id, attempt: 1, status: "verified", memory_hit: n++ % 3 === 0 ? 1 : 0, explanation: "Sample fix.", diff: "--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n-bad\n+good", syntax_ok: 1, finding_gone: 1, new_issues: 0, error: "", session_url: "", latency_ms: 38000 + k * 5000 })
    }
  }
  for (let k = 0; k < 3; k++) {
    const finding_id = randomUUID()
    insert("findings", { finding_id, scan_id, rule_id: "generic.sample.noise", path: `tests/test_${k}.py`, line: 10, end_line: 10, language: "python", semgrep_severity: "WARNING", message: "Sample", snippet: "10  x = 'changeme'" })
    insert("verdicts", { finding_id, scan_id, verdict: "noise", severity: "low", bug_class: "other", title: "Placeholder in a test", why: "Test file.", fix_hint: "", confidence: 0.9, backend: "guild", session_url: "", latency_ms: 3000 })
  }
}
await flush()
await close()
console.log("sample rows written. Open /?sample=1")
