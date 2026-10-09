// Guild client for Patchwork. One API trigger key runs all three agents.
//
//   import { runAgent, parseVerdict, parsePlan, parseFix } from "./lib/guild.mjs"
//   const run = await runAgent(process.env.GUILD_TRIAGE_AGENT, finding)
//   const verdict = parseVerdict(run.events)   // null if not found
//   run.session_url is the audit trail link to store with every result
//
// Env: GUILD_KEY="<api_key_id>:<api_key_secret>"  GUILD_WORKSPACE="<owner>/<workspace>"
//
// Guild's docs do not say which session event carries the agent's final answer,
// so the parsers search every string in the events (newest first) and accept the
// first one that validates. If a parser returns null, log run.events and adjust.

const BASE = "https://api.guild.ai/v1"
const FINISHED = new Set(["DONE", "ERROR", "INTERRUPTED"])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function config() {
  const key = process.env.GUILD_KEY
  const workspace = process.env.GUILD_WORKSPACE
  if (!key || !workspace) {
    throw new Error('Set GUILD_KEY="id:secret" and GUILD_WORKSPACE="owner/workspace"')
  }
  return {
    workspace,
    headers: {
      Authorization: "Basic " + Buffer.from(key).toString("base64"),
      "Content-Type": "application/json",
    },
  }
}

async function api(path, options = {}) {
  const { headers } = config()
  // GETs are retried: Guild's gateway sometimes answers 502/504 under load.
  const attempts = options.method && options.method !== "GET" ? 1 : 4
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(BASE + path, { ...options, headers, signal: AbortSignal.timeout(60000) }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }))
    if (res.ok) return res.json()
    lastErr = new Error(`Guild ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`)
    if (![0, 429, 500, 502, 503, 504].includes(res.status) || i === attempts) throw lastErr
    await sleep(1500 * i)
  }
  throw lastErr
}

// agentId: "owner~agent-name" or a UUID. Omit to run the trigger's own agent.
export async function runAgent(agentId, input, { timeoutMs = 180000, pollMs = 1500 } = {}) {
  const { workspace } = config()
  const started = Date.now()
  const body = { session_type: process.env.GUILD_SESSION_TYPE || "api_trigger", agent_input: input }
  if (agentId) body.agent_id = agentId

  const session = await api(`/workspaces/${workspace}/sessions`, {
    method: "POST",
    body: JSON.stringify(body),
  })

  let status = session.root_task?.status
  while (!FINISHED.has(status)) {
    if (Date.now() - started > timeoutMs) throw new Error(`Guild timed out: ${session.session_url}`)
    await sleep(pollMs)
    status = (await api(`/sessions/${session.id}`)).root_task?.status
  }
  if (status !== "DONE") throw new Error(`Guild agent ended as ${status}: ${session.session_url}`)

  const events = (await api(`/sessions/${session.id}/events?limit=200`)).items
  return {
    events,
    session_id: session.id,
    session_url: session.session_url,
    latency_ms: Date.now() - started,
  }
}

// Every string inside a value, depth first. A string that is itself JSON is
// opened up too, because event payloads are sometimes JSON inside a string.
function* strings(value, depth = 0) {
  if (depth > 8) return
  if (typeof value === "string") {
    yield value
    const trimmed = value.trim()
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        yield* strings(JSON.parse(trimmed), depth + 1)
      } catch {}
    }
  } else if (Array.isArray(value)) {
    for (const item of value) yield* strings(item, depth + 1)
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) yield* strings(item, depth + 1)
  }
}

function extractJson(events, isValid) {
  for (const text of strings(events)) {
    const first = text.indexOf("{")
    const last = text.lastIndexOf("}")
    if (first === -1 || last <= first) continue
    try {
      const parsed = JSON.parse(text.slice(first, last + 1))
      if (isValid(parsed)) return parsed
    } catch {}
  }
  return null
}

export function parseVerdict(events) {
  return extractJson(
    events,
    (o) => o && (o.verdict === "real" || o.verdict === "noise") && typeof o.title === "string",
  )
}

export function parsePlan(events) {
  return extractJson(
    events,
    (o) => o && Array.isArray(o.steps) && o.steps.every((s) => Array.isArray(s.finding_ids)),
  )
}

const FIX_RE =
  /START_LINE:\s*(\d+)\s*\r?\nEND_LINE:\s*(\d+)\s*\r?\nEXPLANATION:\s*([^\r\n]*)\r?\n<<<REPLACEMENT\r?\n([\s\S]*?)\r?\n?REPLACEMENT>>>/

export function parseFix(events) {
  for (const text of strings(events)) {
    const m = FIX_RE.exec(text)
    if (!m) continue
    const start_line = Number(m[1])
    const end_line = Number(m[2])
    if (!Number.isInteger(start_line) || end_line < start_line) continue
    return { start_line, end_line, explanation: m[3].trim(), replacement: m[4] }
  }
  return null
}
