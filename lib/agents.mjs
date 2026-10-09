// runAgent wrapper. Picks the backend: Guild (default) or OpenAI (emergency fallback).
// The fallback reuses the exact system prompts and input templates from agents/*/agent.ts
// so both backends see the same instructions. backend is stored on every row.
import { readFile } from "node:fs/promises"
import { runAgent as guildRun } from "./guild.mjs"

export const BACKEND = process.env.AGENT_BACKEND || "guild"

const AGENT_FILES = {
  triage: "triage-agent",
  planner: "planner-agent",
  fixer: "fixer-agent",
}
const AGENT_ENV = {
  triage: "GUILD_TRIAGE_AGENT",
  planner: "GUILD_PLANNER_AGENT",
  fixer: "GUILD_FIXER_AGENT",
}

const promptCache = new Map()
async function prompts(kind) {
  if (promptCache.has(kind)) return promptCache.get(kind)
  const src = await readFile(new URL(`../agents/${AGENT_FILES[kind]}/agent.ts`, import.meta.url), "utf8")
  const system = src.match(/const systemPrompt = `([\s\S]*?)`\n/)?.[1]
  const template = src.match(/inputTemplate: `([\s\S]*?)`,\n/)?.[1]
  if (!system || !template) throw new Error(`Could not read prompts from ${kind} agent.ts`)
  const out = { system: system.trim(), template }
  promptCache.set(kind, out)
  return out
}

function fill(template, input) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (input[k] === undefined || input[k] === null ? "" : String(input[k])))
}

async function openaiRun(kind, input) {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error("AGENT_BACKEND=openai needs OPENAI_API_KEY")
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini"
  const { system, template } = await prompts(kind)
  const started = Date.now()
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: fill(template, input) },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content || ""
  return { events: [{ type: "fallback_answer", text }], session_id: data.id, session_url: "", latency_ms: Date.now() - started }
}

// kind: triage | planner | fixer. Returns { events, session_url, latency_ms, backend }.
export async function runAgent(kind, input, options) {
  if (BACKEND === "openai") return { ...(await openaiRun(kind, input)), backend: "openai" }
  const agentId = process.env[AGENT_ENV[kind]]
  if (!agentId) throw new Error(`Set ${AGENT_ENV[kind]} in .env`)
  return { ...(await guildRun(agentId, input, options)), backend: "guild" }
}

export { parseVerdict, parsePlan, parseFix } from "./guild.mjs"
