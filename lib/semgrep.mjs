// Run Semgrep on a directory or one file. Never through a shell string.
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const run = promisify(execFile)
const SEMGREP = process.env.SEMGREP_BIN || "semgrep"
const CONFIG = (process.env.SEMGREP_CONFIG || "auto").split(",")

const SKIP_PATH = /(^|\/)(node_modules|vendor|dist|build|\.next|\.git|__pycache__|\.venv|venv)(\/|$)/
const SKIP_FILE = /(\.min\.(js|css)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|composer\.lock)$)/
const RANK = { ERROR: 0, WARNING: 1, INFO: 2 }

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

// target: "." for the whole clone, or a path relative to cwd for one file.
export async function scan(cwd, target = ".", { timeoutMs = 180000 } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "patchwork-semgrep-"))
  const out = path.join(tmp, "results.json")
  const started = Date.now()
  const args = []
  for (const c of CONFIG) args.push("--config", c)
  args.push("--json", "--quiet", "--timeout", "20", "--max-target-bytes", "1000000", "--output", out, target)
  try {
    await run(SEMGREP, ["scan", ...args], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      env: process.env,
    })
  } catch (err) {
    // Semgrep exits 1 when findings exist with some configs; only fail if no output file.
    const exists = await readFile(out, "utf8").catch(() => null)
    if (exists === null) {
      await rm(tmp, { recursive: true, force: true })
      throw new Error(`semgrep failed: ${(err.stderr || err.message || "").toString().slice(0, 500)}`)
    }
  }
  const raw = JSON.parse(await readFile(out, "utf8"))
  await rm(tmp, { recursive: true, force: true })
  return {
    results: normalize(raw.results || []),
    errors: (raw.errors || []).length,
    duration_ms: Date.now() - started,
  }
}

export function normalize(results) {
  return results.map((r) => ({
    rule_id: r.check_id,
    path: r.path.replace(/^\.\//, ""),
    line: r.start?.line ?? 0,
    end_line: r.end?.line ?? r.start?.line ?? 0,
    message: r.extra?.message || "",
    semgrep_severity: r.extra?.severity || "UNKNOWN",
    language: languageOf(r.path),
  }))
}

// Drop vendored and generated paths, rank by severity, keep original order within a tier.
export function filterAndRank(results) {
  return results
    .filter((r) => !SKIP_PATH.test(r.path) && !SKIP_FILE.test(r.path))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (RANK[a.r.semgrep_severity] ?? 3) - (RANK[b.r.semgrep_severity] ?? 3) || a.i - b.i)
    .map(({ r }) => r)
}
