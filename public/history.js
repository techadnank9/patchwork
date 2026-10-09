import { $, el, getJSON, header, ago, CLASS_LABEL, bars, CLASS_COLOR, SEV_COLOR, sevChip } from "./app.js"
$("#hdr").replaceWith(header("history.html"))
const SRC = { room: "", fixture: "test fixture", sample: "sample data", public_dataset: "public dataset" }
const STATUS_WORD = { verified: "Patch ready", needs_human: "Needs a human", failed: "Retrying", "": "Not attempted" }
async function loadProjects() {
  const d = await getJSON("api/projects")
  const wrap = $("#projects")
  wrap.replaceChildren(...d.projects.map((p) => {
    const head = el("div", { class: "proj-head" },
      el("div", {}, el("h3", { text: p.team }), p.repo ? el("div", { class: "repo", text: p.repo }) : el("div", { class: "src", text: "team chose not to be named; counts only" })),
      el("div", { class: "proj-nums" },
        el("span", {}, el("b", { class: "real", text: String(p.real) }), " real"),
        el("span", {}, el("b", { text: String(p.noise) }), " noise"),
        el("span", {}, el("b", { class: "fix", text: String(p.verified) }), " patched")),
    )
    const graph = el("div", { class: "proj-graph" }, bars(p.by_class, { colorFor: (k) => CLASS_COLOR[k] || "var(--gray)", labelFor: (k) => CLASS_LABEL[k] || k }))
    const list = p.issues ? el("ul", { class: "vulns" }, ...p.issues.map((i) => el("li", {},
      el("div", { class: "v-top" }, sevChip(i.severity), el("b", { text: i.title }), el("span", { class: "chip noise", text: CLASS_LABEL[i.bug_class] || i.bug_class }), el("span", { class: `chip ${i.status === "verified" ? "ready" : i.status ? "human" : "none"}`, text: STATUS_WORD[i.status] || i.status }), i.memory_hit ? el("span", { class: "chip fixed", text: "memory assisted" }) : null),
      el("div", { class: "v-loc", text: `${i.path}:${i.line}` }),
      el("div", { class: "v-why", text: i.why }),
      i.fix_hint ? el("div", { class: "v-how" }, el("b", { text: "How to patch: " }), i.fix_hint) : null,
    ))) : null
    return el("article", { class: "proj" }, head, p.real ? graph : el("p", { class: "src", text: p.findings ? "Every finding was ruled out as noise." : "Clean scan." }), list)
  }))
  if (!d.projects.length) wrap.replaceChildren(el("p", { class: "note", text: "No room projects yet." }))
}
async function load() {
  loadProjects().catch(() => {})
  const d = await getJSON("api/history")
  $("#meta").textContent = `${d.scans.length} scans · ClickHouse answered in ${d.query_ms} ms`
  $("#rows").replaceChildren(...d.scans.map((s) => el("tr", {},
    el("td", { class: "when", text: ago(s.created_at) }),
    el("td", {}, el("div", { class: "team", text: s.is_public ? s.team : `${s.team} (not on board)` }), el("div", { class: "repo", text: s.repo_url.replace("https://github.com/", "") }), SRC[s.source] ? el("div", { class: "src", text: SRC[s.source] }) : null,
      s.bug_classes?.length ? el("div", { class: "classes" }, ...s.bug_classes.map((c) => el("span", { text: CLASS_LABEL[c] || c }))) : null),
    el("td", {}, el("span", { class: `chip ${s.stage === "done" ? "fixed" : s.stage === "error" ? "high" : "none"}`, text: s.stage || "queued" }), el("div", { class: "src", text: s.stage === "done" ? "" : s.detail || "" })),
    el("td", { class: "num", text: String(s.findings ?? 0) }),
    el("td", { class: "num real", text: String(s.real_issues ?? 0) }),
    el("td", { class: "num", text: String(s.noise ?? 0) }),
    el("td", { class: "num fix", text: String(s.verified_fixes ?? 0) }),
    el("td", { class: "num", text: String(s.needs_human ?? 0) }),
  )))
  if (!d.scans.length) $("#rows").replaceChildren(el("tr", { class: "empty" }, el("td", { colspan: 8, text: "No scans yet." })))
}
load(); setInterval(load, 5000)
