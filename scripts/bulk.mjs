// Queue many repos through the running server. One line per repo in the input file:
//   https://github.com/owner/repo | Team name | public
// "public" is optional and means the team agreed to be named on the board.
// Lines starting with # are ignored. Pass --source public_dataset to label past-hackathon repos
// so they count separately and never appear on the room board.
//   node --env-file=.env scripts/bulk.mjs repos.txt [--source public_dataset]
import { readFile } from "node:fs/promises"
import { randomBytes, randomUUID } from "node:crypto"
import { insertNow, close } from "../lib/db.mjs"
import { validateRepoUrl } from "../lib/repo.mjs"
import { runScan } from "../worker.mjs"

const [file, ...rest] = process.argv.slice(2)
if (!file) { console.error("usage: bulk.mjs repos.txt [--source public_dataset]"); process.exit(1) }
const source = rest.includes("--source") ? rest[rest.indexOf("--source") + 1] : "room"
const concurrency = Number(process.env.SCAN_CONCURRENCY || 2)
const lines = (await readFile(file, "utf8")).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
const jobs = []
for (const line of lines) {
  const [url, team = "A team", flag = ""] = line.split("|").map((s) => s.trim())
  try {
    const repo_url = validateRepoUrl(url)
    jobs.push({ repo_url, team: team.slice(0, 60), is_public: /^public$/i.test(flag) ? 1 : 0 })
  } catch (e) {
    console.error(`skip: ${line} (${e.message})`)
  }
}
console.log(`${jobs.length} repos, source=${source}, ${concurrency} at a time`)
const queue = [...jobs]
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (queue.length) {
    const job = queue.shift()
    const scan_id = randomUUID()
    const token = randomBytes(16).toString("hex")
    await insertNow("scans", { scan_id, token, ...job, source })
    try {
      const out = await runScan({ scan_id, ...job, source })
      console.log(`done ${job.team}: ${JSON.stringify(out.totals)}  report: ${process.env.PUBLIC_BASE_URL}/report.html?scan=${scan_id}&t=${token}`)
    } catch (e) {
      console.error(`failed ${job.team} ${job.repo_url}: ${e.message}`)
    }
  }
}))
await close()
