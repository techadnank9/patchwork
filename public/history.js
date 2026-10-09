import { $, el, getJSON, header, ago, CLASS_LABEL } from "./app.js"
$("#hdr").replaceWith(header("history.html"))
const SRC = { room: "", fixture: "test fixture", sample: "sample data", public_dataset: "public dataset" }
async function load() {
  const d = await getJSON("api/history")
  $("#meta").textContent = `${d.scans.length} scans · ClickHouse answered in ${d.query_ms} ms`
  $("#rows").replaceChildren(...d.scans.map((s) => el("tr", {},
    el("td", { class: "when", text: ago(s.created_at) }),
    el("td", {}, el("div", { class: "team", text: s.is_public ? s.team : `${s.team} (not on board)` }), el("div", { class: "repo", text: s.repo_url.replace("https://github.com/", "") }), SRC[s.source] ? el("div", { class: "src", text: SRC[s.source] }) : null,
      s.bug_classes?.length ? el("div", { class: "classes" }, ...s.bug_classes.map((c) => el("span", { text: CLASS_LABEL[c] || c }))) : null),
    el("td", {}, el("span", { class: `chip ${s.stage === "done" ? "fixed" : s.stage === "error" ? "high" : "none"}`, text: s.stage || "queued" }), el("div", { class: "src", text: s.stage === "done" ? "" : s.detail || "" })),
    el("td", { class: "num", text: s.findings }),
    el("td", { class: "num real", text: s.real_issues }),
    el("td", { class: "num", text: s.noise }),
    el("td", { class: "num fix", text: s.verified_fixes }),
    el("td", { class: "num", text: s.needs_human }),
  )))
  if (!d.scans.length) $("#rows").replaceChildren(el("tr", { class: "empty" }, el("td", { colspan: 8, text: "No scans yet." })))
}
load(); setInterval(load, 5000)
