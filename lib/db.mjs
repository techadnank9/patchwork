// ClickHouse client for Patchwork.
// - insert(table, row): buffered, flushed every 500 ms as one JSONEachRow batch per table
// - query(sql, params): parameterized, returns { rows, query_ms }
// - flush(): force the buffer out (call before a process exits)
import { createClient } from "@clickhouse/client"

let client = null
function getClient() {
  if (client) return client
  const url = process.env.CLICKHOUSE_URL
  if (!url) throw new Error("Set CLICKHOUSE_URL, CLICKHOUSE_USER and CLICKHOUSE_PASSWORD in .env")
  client = createClient({
    url,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
    request_timeout: 30000,
    clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
  })
  return client
}

const buffer = new Map() // table -> rows[]
let timer = null

export function insert(table, row) {
  if (!buffer.has(table)) buffer.set(table, [])
  buffer.get(table).push(row)
  if (!timer) timer = setTimeout(() => flush().catch((e) => console.error("[db] flush failed:", e.message)), 500)
}

export async function flush() {
  clearTimeout(timer)
  timer = null
  const batches = [...buffer.entries()]
  buffer.clear()
  const work = Promise.all(
    batches.map(([table, values]) =>
      getClient().insert({ table, values, format: "JSONEachRow" }),
    ),
  )
  await work
}

// Insert and wait until the rows are written. Use for the scans row so the
// report page can find it right away.
export async function insertNow(table, row) {
  await getClient().insert({ table, values: [row], format: "JSONEachRow" })
}

export async function query(sql, params = {}) {
  const started = performance.now()
  const result = await getClient().query({ query: sql, query_params: params, format: "JSONEachRow" })
  const rows = await result.json()
  return { rows, query_ms: Math.round((performance.now() - started) * 10) / 10 }
}

export async function command(sql) {
  await getClient().command({ query: sql })
}

export async function ping() {
  const started = performance.now()
  const result = await getClient().query({ query: "SELECT 1 AS ok", format: "JSONEachRow" })
  await result.json()
  return Math.round((performance.now() - started) * 10) / 10
}

export async function close() {
  await flush()
  if (client) await client.close()
}
