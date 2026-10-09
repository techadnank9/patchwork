import { $, el, params, getJSON, fmtSecs, fmtN, CLASS_LABEL, header, when } from "./app.js"
$("#hdr").replaceWith(header("board.html"))
const sample = params.get("sample") === "1"
if (sample) $("#banner").hidden = false
const CLASSES = ["injection", "secrets", "auth", "packages", "crypto", "other"]
const cellState = new Map()

function cellFor(row) {
  if (!row) return { cls: "clean", word: "Clean", count: "" }
  const real = Number(row.real_issues), ready = Number(row.patch_ready), worst = Number(row.worst_open)
  if (real > 0 && ready >= real) return { cls: "ready", word: "Patch ready", count: `${ready}` }
  if (worst === 1) return { cls: "high", word: "High", count: `${real}` }
  if (worst === 2) return { cls: "med", word: "Med", count: `${real}` }
  return { cls: "low", word: "Low", count: `${real}` }
}

function renderGrid(cells) {
  const teams = [...new Set(cells.map((c) => c.team))].sort((a, b) => a.localeCompare(b))
  const tbody = $("#rows")
  if (!teams.length) { tbody.replaceChildren(el("tr", { class: "empty" }, el("td", { colspan: 7, text: "No team has opted onto the board yet. Scan the code to join." }))); return }
  const byKey = new Map(cells.map((c) => [`${c.team}|${c.bug_class}`, c]))
  const rows = teams.map((team) => {
    const tr = el("tr", {}, el("td", { class: "team", text: team, title: team }))
    for (const cls of CLASSES) {
      const key = `${team}|${cls}`
      const s = cellFor(byKey.get(key))
      const flap = el("div", { class: `flap ${s.cls}` }, el("span", { text: s.word }), s.count ? el("span", { class: "count", text: s.count }) : null)
      const prev = cellState.get(key)
      if (prev && prev !== `${s.cls}:${s.count}`) flap.classList.add("flip")
      cellState.set(key, `${s.cls}:${s.count}`)
      tr.append(el("td", { class: "cell" }, flap))
    }
    return tr
  })
  tbody.replaceChildren(...rows)
}

let lastFeedKey = ""
function renderFeed(feed) {
  const key = feed.map((f) => f.ts + f.stage + f.detail).join("|")
  if (key === lastFeedKey) return
  lastFeedKey = key
  $("#feed").replaceChildren(...feed.map((f) => el("li", {},
    el("span", {}, el("b", { text: f.team }), " · ", el("span", { class: `stage ${f.stage}`, text: f.stage })),
    el("span", { class: "t", text: `${f.duration_ms > 0 ? fmtSecs(f.duration_ms) + " · " : ""}${when(f.ts)}` }),
    el("span", { class: "d", text: f.detail }),
  )))
}

function setNum(id, v) { const n = $(id); const t = fmtN(v); if (n.textContent !== t) n.textContent = t }

async function tick() {
  try {
    const b = await getJSON(`api/board${sample ? "?sample=1" : ""}`)
    const t = b.totals
    setNum("#s-projects", t.projects); setNum("#s-findings", t.raw_findings); setNum("#s-noise", t.noise_removed)
    setNum("#s-real", t.real_issues); setNum("#s-fixes", t.verified_fixes); setNum("#s-memory", t.memory_assisted_fixes)
    $("#s-median").textContent = b.speed?.verified > 0 ? String(b.speed.median_fix_seconds) : "–"
    $("#m-rows").textContent = fmtN(b.rows_total); $("#m-ms").textContent = String(b.query_ms)
    $("#m-queue").textContent = b.queue.running || b.queue.waiting ? `Scanning ${b.queue.running}, waiting ${b.queue.waiting}` : "Queue idle"
    renderGrid(b.cells)
    renderFeed(b.feed)
    const v = $("#variants")
    if (b.variants.length) v.replaceChildren(...b.variants.map((r) => el("li", {}, el("span", { text: r.title || r.rule_id.split(".").pop() }), el("span", { text: `${r.projects} projects` }))))
    if (b.headline) {
      $("#headline").replaceChildren(el("span", { text: CLASS_LABEL[b.headline.bug_class] || b.headline.bug_class }))
      $("#headline-facts").replaceChildren(el("li", {}, el("span", { text: "Projects with it" }), el("span", { text: String(b.headline.projects) })), el("li", {}, el("span", { text: "Confirmed issues" }), el("span", { text: String(b.headline.issues) })))
    }
  } catch (e) {
    $("#m-queue").textContent = `Board offline: ${e.message}`
  }
}
tick(); setInterval(tick, 2000)
