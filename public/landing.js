import { $, el, getJSON, header, fmtN, fmtSecs, when, CLASS_LABEL, bars, CLASS_COLOR } from "./app.js"
$("#hdr").replaceWith(header("index.html"))
async function pulse() {
  try {
    const p = await getJSON("api/pulse")
    $("#p-projects").textContent = fmtN(p.projects)
    $("#p-real").textContent = fmtN(p.real_issues)
    $("#p-noise").textContent = fmtN(p.noise_removed)
    $("#p-fixes").textContent = fmtN(p.verified_fixes)
    $("#p-median").textContent = p.median_fix_seconds ? String(p.median_fix_seconds) : "–"
  } catch {}
}
async function room() {
  try {
    const [b, pr] = await Promise.all([getJSON("api/board"), getJSON("api/projects")])
    $("#lr-meta").textContent = `ClickHouse answered in ${b.query_ms} ms · ${fmtN(b.rows_total)} rows`
    const pub = pr.projects.filter((p) => p.is_public)
    if (pub.length) $("#lr-projects").replaceChildren(...pub.slice(0, 8).map((p) => el("li", {},
      el("b", { text: p.team }), el("span", { class: "muted", text: p.repo }),
      el("span", { class: "lr-n" }, el("span", { class: "red", text: `${p.real} real` }), el("span", { class: "blue", text: `${p.verified} patched` })))))
    const classes = {}
    for (const p of pr.projects) for (const [k, v] of Object.entries(p.by_class || {})) classes[k] = (classes[k] || 0) + v
    $("#lr-classes").replaceChildren(bars(classes, { colorFor: (k) => CLASS_COLOR[k] || "var(--gray)", labelFor: (k) => CLASS_LABEL[k] || k }))
    if (b.variants.length) $("#lr-variants").replaceChildren(...b.variants.slice(0, 5).map((v) => el("li", {}, el("span", { text: v.title || v.rule_id.split(".").pop() }), el("b", { text: `${v.projects} projects` }))))
    $("#lr-feed").replaceChildren(...b.feed.slice(0, 8).map((f) => el("li", {}, el("span", { class: "muted", text: when(f.ts) }), el("b", { text: f.team }), el("span", { class: "amber", text: f.stage }), el("span", { text: f.detail }))))
  } catch {}
}
pulse(); room(); setInterval(pulse, 5000); setInterval(room, 4000)
