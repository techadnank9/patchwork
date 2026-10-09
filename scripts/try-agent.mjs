// node --env-file=.env scripts/try-agent.mjs <triage|planner|fixer> <input.json>
import { readFile } from "node:fs/promises"
import { runAgent, parseVerdict, parsePlan, parseFix } from "../lib/agents.mjs"

const [kind, file] = process.argv.slice(2)
const parsers = { triage: parseVerdict, planner: parsePlan, fixer: parseFix }
if (!parsers[kind] || !file) {
  console.error("usage: try-agent.mjs <triage|planner|fixer> <input.json>")
  process.exit(1)
}
const input = JSON.parse(await readFile(file, "utf8"))
const run = await runAgent(kind, input)
const parsed = parsers[kind](run.events)
console.log(`backend: ${run.backend}  latency: ${run.latency_ms} ms`)
console.log(`session: ${run.session_url}`)
if (parsed) console.log(JSON.stringify(parsed, null, 2))
else {
  console.log("PARSE FAILED. Raw events:")
  console.log(JSON.stringify(run.events, null, 1).slice(0, 20000))
}
