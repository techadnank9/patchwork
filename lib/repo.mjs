// Validate a GitHub URL, shallow clone into work/<scan_id>/, read files safely.
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir, readFile, realpath, rm, stat } from "node:fs/promises"
import path from "node:path"

const run = promisify(execFile)
export const WORK_DIR = path.resolve(process.cwd(), "work")
const REPO_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/
const MAX_CLONE_BYTES = 300 * 1024 * 1024

export function validateRepoUrl(url) {
  if (typeof url !== "string") throw new Error("Repo link must be text")
  const trimmed = url.trim()
  if (!REPO_RE.test(trimmed)) {
    throw new Error("Only public GitHub links work, like https://github.com/owner/repo")
  }
  if (trimmed.includes("..")) throw new Error("Invalid repo link")
  return trimmed.replace(/\/$/, "")
}

export function repoSlug(url) {
  return validateRepoUrl(url).replace("https://github.com/", "").replace(/\.git$/, "")
}

export async function cloneRepo(url, scan_id) {
  const clean = validateRepoUrl(url)
  if (!/^[\w-]+$/.test(scan_id)) throw new Error("bad scan id")
  await mkdir(WORK_DIR, { recursive: true })
  const dir = path.join(WORK_DIR, scan_id)
  await rm(dir, { recursive: true, force: true })
  await run(
    "git",
    ["-c", "core.symlinks=false", "clone", "--depth", "1", "--single-branch", "--no-recurse-submodules", clean, dir],
    { timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" }, maxBuffer: 4 * 1024 * 1024 },
  )
  const size = await dirSize(dir)
  if (size > MAX_CLONE_BYTES) {
    await rm(dir, { recursive: true, force: true })
    throw new Error(`Repo is ${Math.round(size / 1024 / 1024)} MB, over the 300 MB limit`)
  }
  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: dir, timeout: 10000 })
  return { dir, sha: stdout.trim(), bytes: size }
}

async function dirSize(dir) {
  const { stdout } = await run("du", ["-sk", dir], { timeout: 30000 })
  return Number(stdout.split("\t")[0]) * 1024
}

// Resolve a repo relative path and refuse anything that escapes the clone.
export async function safePath(dir, rel) {
  const root = await realpath(dir)
  const target = path.resolve(root, rel)
  if (!target.startsWith(root + path.sep)) throw new Error(`Path escapes clone: ${rel}`)
  const real = await realpath(target)
  if (!real.startsWith(root + path.sep)) throw new Error(`Path escapes clone: ${rel}`)
  return real
}

export async function readRepoFile(dir, rel, maxBytes = 2 * 1024 * 1024) {
  const file = await safePath(dir, rel)
  const info = await stat(file)
  if (!info.isFile()) throw new Error(`Not a file: ${rel}`)
  if (info.size > maxBytes) throw new Error(`File too large: ${rel}`)
  return readFile(file, "utf8")
}

// 12 lines either side, each prefixed with its number.
export function snippetAround(text, line, context = 12) {
  const lines = text.split(/\r?\n/)
  const start = Math.max(1, line - context)
  const end = Math.min(lines.length, line + context)
  const width = String(end).length
  const out = []
  for (let n = start; n <= end; n++) out.push(`${String(n).padStart(width)}  ${lines[n - 1] ?? ""}`)
  return out.join("\n")
}

export async function removeClone(dir) {
  const root = await realpath(WORK_DIR).catch(() => WORK_DIR)
  const real = await realpath(dir).catch(() => null)
  if (real && real.startsWith(root + path.sep)) await rm(real, { recursive: true, force: true })
}
