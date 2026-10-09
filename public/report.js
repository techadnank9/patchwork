import { $, el, params, getJSON, header, sevChip, statusChip, copyButton, when, CLASS_LABEL } from "./app.js"
$("#hdr").replaceWith(header())
const scan = params.get("scan"), t = params.get("t")
const STAGE_WORD = { queued: "Queued", cloning: "Cloning", scanning: "Scanning", triaging: "Triaging", planning: "Planning", fixing: "Fixing", verifying: "Verifying", done: "Done", error: "Stopped" }
let timer

async function load() {
  let d
  try { d = await getJSON(`api/scans/${encodeURIComponent(scan)}?t=${encodeURIComponent(t)}`) }
  catch (e) { $("#team").textContent = "Report not found"; $("#stage").hidden = true; $("#stage-detail").textContent = e.message; clearInterval(timer); return }
  document.title = `${d.scan.team} · Patchwork report`
  $("#team").textContent = d.scan.team
  $("#repo").textContent = d.scan.repo_url.replace("https://github.com/", "")
  $("#created").textContent = `Scan started ${when(d.scan.created_at)}`
  const st = d.status
  $("#stage-word").textContent = STAGE_WORD[st.stage] || st.stage
  $("#stage-detail").textContent = st.detail && st.stage !== "done" ? st.detail : st.stage === "done" ? "Everything below is final. Rescan any time." : ""
  $("#stage").className = `stage-line ${st.stage === "done" ? "done" : st.stage === "error" ? "error" : ""}`
  if (st.stage === "done" || st.stage === "error") clearInterval(timer)

  const ready = d.issues.filter((i) => i.fix?.status === "verified").length
  $("#c-real").textContent = d.issues.length; $("#c-noise").textContent = d.noise.length
  $("#c-ready").textContent = ready; $("#c-findings").textContent = d.findings_total

  if (d.plan) {
    $("#plan-sec").hidden = false
    $("#plan-summary").textContent = d.plan.summary || ""
    $("#steps").replaceChildren(...(d.plan.steps || []).map((s) => el("li", {},
      el("div", {},
        el("h3", { text: s.title }),
        el("p", { class: "change", text: s.change }),
        el("p", { class: "why", text: s.root_cause ? `Root cause: ${s.root_cause}` : "" }),
        el("p", { class: "facts" },
          el("span", {}, "Risk ", el("b", { text: s.risk || "–" })),
          el("span", {}, "About ", el("b", { text: `${s.effort_minutes ?? "?"} min` })),
          el("span", {}, "Issues ", el("b", { text: String((s.finding_ids || []).length) })),
          (s.files || []).length ? el("span", {}, "Files ", el("b", { text: s.files.join(", ") })) : null,
        ),
      ),
    )))
    if (d.plan_session) $("#plan-link").replaceChildren("Planner session on Guild: ", el("a", { href: d.plan_session, target: "_blank", rel: "noopener", text: "open audit trail" }))
  }

  const link = (i) => `fix.html?scan=${encodeURIComponent(scan)}&t=${encodeURIComponent(t)}&f=${encodeURIComponent(i.finding_id)}`
  $("#issues").replaceChildren(...d.issues.map((i) => el("li", {}, el("a", { href: link(i) },
    el("span", { class: "t" }, el("span", { text: i.title }), sevChip(i.severity), el("span", { class: "chip noise", text: CLASS_LABEL[i.bug_class] || i.bug_class })),
    el("span", { class: "status" }, statusChip(i)),
    el("span", { class: "why" }, el("span", { class: "loc", text: `${i.path}:${i.line}  ` }), i.why),
  ))))
  const empty = $("#issues-empty")
  if (!d.issues.length) {
    empty.hidden = false
    empty.textContent = st.stage === "done" ? (d.findings_total ? "Every finding was ruled out as noise. Nothing to fix." : "Semgrep found nothing to look at. Clean scan.") : "Issues appear here as triage confirms them."
  } else empty.hidden = true

  if (d.patch_available) {
    $("#actions").hidden = false; $("#verify-note").hidden = false
    $("#dl").href = `api/scans/${encodeURIComponent(scan)}/patch?t=${encodeURIComponent(t)}`
    if (!$("#cmd button")) $("#cmd").append(copyButton("git apply patchwork.patch"))
  }
  $("#secret-note").hidden = !d.issues.some((i) => i.bug_class === "secrets")
  if (d.noise.length) {
    $("#noise-sec").hidden = false
    $("#noise-summary").textContent = `${d.noise.length} finding${d.noise.length === 1 ? "" : "s"} we ruled out, and why`
    $("#noise").replaceChildren(...d.noise.map((i) => el("li", {}, el("a", { href: link(i) },
      el("span", { class: "t" }, el("span", { text: i.title }), el("span", { class: "chip noise", text: "Noise" })),
      el("span", { class: "why" }, el("span", { class: "loc", text: `${i.path}:${i.line}  ` }), i.why),
    ))))
  }
}
load(); timer = setInterval(load, 2000)
