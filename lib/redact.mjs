// Mask likely secrets before text leaves the worker. Keeps the first 4 characters.
const MASK = "…[masked]"
const keep = (s) => s.slice(0, 4) + MASK

const TOKEN_PATTERNS = [
  /sk_live_[A-Za-z0-9]{8,}/g,
  /sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{12,}/g,
  /xox[bapsr]-[A-Za-z0-9-]{10,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
]

// name containing key/secret/token/password/passwd, then = or :, then a quoted string of 20+ chars
const ASSIGN_RE =
  /([A-Za-z0-9_.-]*(?:key|secret|token|password|passwd)[A-Za-z0-9_.-]*\s*[:=]\s*)(["'`])([^"'`\r\n]{20,})\2/gi

const PEM_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g

export function redact(text) {
  if (typeof text !== "string" || !text) return text
  let out = text
  out = out.replace(PEM_RE, (m) => m.slice(0, 31) + MASK)
  for (const re of TOKEN_PATTERNS) out = out.replace(re, (m) => keep(m))
  out = out.replace(ASSIGN_RE, (m, lhs, q, value) => `${lhs}${q}${keep(value)}${q}`)
  return out
}

export const MASK_MARK = "[masked]"
