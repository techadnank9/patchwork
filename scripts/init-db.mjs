// Runs every statement in schema.sql, then lists tables and views with a round trip time.
//   node --env-file=.env scripts/init-db.mjs
import { readFile } from "node:fs/promises"
import { command, query, ping, close } from "../lib/db.mjs"

const sql = await readFile(new URL("../schema.sql", import.meta.url), "utf8")
const statements = sql
  .split(";")
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean)

for (const statement of statements) {
  const name = statement.match(/(?:TABLE|VIEW) IF NOT EXISTS (\w+)/i)?.[1] || statement.slice(0, 40)
  await command(statement)
  console.log("ok  ", name)
}

const { rows, query_ms } = await query(
  "SELECT name, engine FROM system.tables WHERE database = currentDatabase() ORDER BY name",
)
const tables = rows.filter((r) => r.engine !== "View")
const views = rows.filter((r) => r.engine === "View")
console.log(`\n${tables.length} tables: ${tables.map((t) => t.name).join(", ")}`)
console.log(`${views.length} view: ${views.map((v) => v.name).join(", ")}`)
console.log(`list query: ${query_ms} ms, ping round trip: ${await ping()} ms`)
await close()
