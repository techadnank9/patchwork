// Built-in pattern scanner. Reads files only; never runs anything from the clone.
// Same shape as before: scan(dir, target) -> { results, errors, duration_ms }.
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

const SKIP_PATH = /(^|\/)(node_modules|vendor|dist|build|\.next|\.git|__pycache__|\.venv|venv)(\/|$)/
const SKIP_FILE = /(\.min\.(js|css)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|composer\.lock)$)/
const RANK = { ERROR: 0, WARNING: 1, INFO: 2 }
const MAX_BYTES = 1000000
const MAX_FILES = 5000

const EXT_LANG = {
  py: "python", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", go: "go", rb: "ruby", java: "java", php: "php",
  rs: "rust", kt: "kotlin", swift: "swift", cs: "csharp", scala: "scala", sh: "bash",
  yaml: "yaml", yml: "yaml", json: "json", tf: "terraform", html: "html", sql: "sql",
  dockerfile: "dockerfile",
}
export function languageOf(p) {
  const base = path.basename(p).toLowerCase()
  if (base === "dockerfile") return "dockerfile"
  return EXT_LANG[base.split(".").pop()] || "unknown"
}

const JS = ["javascript", "typescript"]
const ALL = null

// Each rule: id, languages (null = any text file), severity, message, pattern (per line).
export const RULES = [
  { id: "python.sql.string-concat-in-execute", langs: ["python"], severity: "ERROR",
    message: "SQL query built with string concatenation or formatting. Use parameterized queries.",
    pattern: /\.(execute|executemany|raw)\s*\(\s*(f["']|["'][^"']*["']\s*(\+|%)|[^,)]*\.format\()/ },
  { id: "python.subprocess.shell-true", langs: ["python"], severity: "ERROR",
    message: "subprocess call with shell=True. Pass an argument list and drop shell=True.",
    pattern: /subprocess\.\w+\(.*shell\s*=\s*True/ },
  { id: "python.os.system", langs: ["python"], severity: "WARNING",
    message: "os.system / os.popen runs a shell command. Use subprocess with an argument list.",
    pattern: /\bos\.(system|popen)\s*\(/ },
  { id: "python.eval-exec", langs: ["python"], severity: "ERROR",
    message: "eval/exec on dynamic input can run arbitrary code.",
    pattern: /(^|[^.\w])(eval|exec)\s*\((?!\s*["'])/ },
  { id: "python.pickle.loads", langs: ["python"], severity: "WARNING",
    message: "pickle can execute code when loading untrusted data.",
    pattern: /\bpickle\.(loads?|Unpickler)\s*\(/ },
  { id: "python.yaml.unsafe-load", langs: ["python"], severity: "WARNING",
    message: "yaml.load without SafeLoader can construct arbitrary objects. Use yaml.safe_load.",
    pattern: /\byaml\.load\s*\((?!.*SafeLoader)/ },
  { id: "python.requests.verify-false", langs: ["python"], severity: "WARNING",
    message: "TLS certificate verification disabled.",
    pattern: /\brequests\.\w+\(.*verify\s*=\s*False/ },
  { id: "python.flask.debug-true", langs: ["python"], severity: "WARNING",
    message: "Flask debug mode enables the interactive debugger. Do not ship it.",
    pattern: /\.run\(.*debug\s*=\s*True/ },
  { id: "js.eval", langs: JS, severity: "ERROR",
    message: "eval / new Function on dynamic input can run arbitrary code.",
    pattern: /(^|[^.\w])(eval\s*\((?!\s*["'`])|new\s+Function\s*\()/ },
  { id: "js.child-process.exec-concat", langs: JS, severity: "ERROR",
    message: "Shell command built from a string with variables. Use execFile/spawn with an argument list.",
    pattern: /\b(exec|execSync)\s*\(\s*(`[^`]*\$\{|["'][^"']*["']\s*\+)/ },
  { id: "js.sql.string-concat", langs: JS, severity: "ERROR",
    message: "SQL query built with string concatenation or template interpolation. Use placeholders.",
    pattern: /\.(query|execute|raw)\s*\(\s*(`\s*(SELECT|INSERT|UPDATE|DELETE)[^`]*\$\{|["']\s*(SELECT|INSERT|UPDATE|DELETE)[^"']*["']\s*\+)/i },
  { id: "js.dom.innerhtml", langs: JS, severity: "WARNING",
    message: "Assigning to innerHTML / outerHTML with dynamic content allows XSS.",
    pattern: /\.(innerHTML|outerHTML)\s*=\s*(?!\s*["'`][^"'`$]*["'`]\s*;?\s*$)/ },
  { id: "js.react.dangerously-set-inner-html", langs: JS, severity: "WARNING",
    message: "dangerouslySetInnerHTML renders raw HTML. Sanitize it first.",
    pattern: /dangerouslySetInnerHTML/ },
  { id: "js.tls.reject-unauthorized-false", langs: JS, severity: "WARNING",
    message: "TLS certificate verification disabled.",
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/ },
  { id: "generic.secrets.hardcoded-secret", langs: ALL, severity: "ERROR",
    message: "Hardcoded secret. Load it from the environment or a secret store.",
    pattern: /\b[\w-]*(secret|password|passwd|api[_-]?key|private[_-]?key|access[_-]?token|auth[_-]?token)[\w-]*["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i,
    skip: /process\.env|os\.environ|getenv|example|placeholder|your[_-]|<|\$\{/i },
  { id: "generic.secrets.known-token-format", langs: ALL, severity: "ERROR",
    message: "Value looks like a real API token. Revoke it and move it out of the code.",
    pattern: /\b(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|sk_live_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{35}|sk-(proj-)?[A-Za-z0-9]{32,})\b/ },
  { id: "generic.crypto.weak-hash", langs: ALL, severity: "INFO",
    message: "MD5/SHA1 are weak. Do not use them for passwords or signatures.",
    pattern: /\b(hashlib\.(md5|sha1)\s*\(|createHash\s*\(\s*["'](md5|sha1)["'])/i },
]

async function listFiles(root, rel, out) {
  if (out.length >= MAX_FILES) return
  const abs = path.join(root, rel)
  const st = await stat(abs)
  if (st.isFile()) { out.push(rel); return }
  if (!st.isDirectory()) return
  for (const name of await readdir(abs)) {
    const child = rel === "." ? name : path.join(rel, name)
    if (SKIP_PATH.test(child)) continue
    const s = await stat(path.join(root, child)).catch(() => null)
    if (!s || s.isSymbolicLink?.()) continue
    if (s.isDirectory()) await listFiles(root, child, out)
    else if (s.isFile()) out.push(child)
    if (out.length >= MAX_FILES) return
  }
}

export function scanText(relPath, text) {
  const language = languageOf(relPath)
  const results = []
  const lines = text.split("\n")
  for (const rule of RULES) {
    if (rule.langs && !rule.langs.includes(language)) continue
    lines.forEach((l, i) => {
      if (l.length > 2000 || !rule.pattern.test(l)) return
      if (rule.skip && rule.skip.test(l)) return
      results.push({ rule_id: rule.id, path: relPath.replace(/^\.\//, ""), line: i + 1, end_line: i + 1,
        message: rule.message, rule_severity: rule.severity, language })
    })
  }
  return results.sort((a, b) => a.line - b.line)
}

// target: "." for the whole clone, or a path relative to cwd for one file.
export async function scan(cwd, target = ".", { timeoutMs = 180000 } = {}) {
  const started = Date.now()
  const files = []
  await listFiles(cwd, target, files)
  const results = []
  let errors = 0
  for (const rel of files) {
    if (Date.now() - started > timeoutMs) { errors++; break }
    if (languageOf(rel) === "unknown") continue
    try {
      const abs = path.join(cwd, rel)
      if ((await stat(abs)).size > MAX_BYTES) continue
      results.push(...scanText(rel, await readFile(abs, "utf8")))
    } catch {
      errors++
    }
  }
  return { results, errors, duration_ms: Date.now() - started }
}

// Drop vendored and generated paths, rank by severity, keep original order within a tier.
export function filterAndRank(results) {
  return results
    .filter((r) => !SKIP_PATH.test(r.path) && !SKIP_FILE.test(r.path))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (RANK[a.r.rule_severity] ?? 3) - (RANK[b.r.rule_severity] ?? 3) || a.i - b.i)
    .map(({ r }) => r)
}
