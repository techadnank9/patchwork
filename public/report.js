import { $, el, params, getJSON, header, sevChip, statusChip, copyButton, when, CLASS_LABEL } from "./app.js"
$("#hdr").replaceWith(header())
const scan = params.get("scan"), t = params.get("t")
const STAGE_WORD = { queued: "Queued", cloning: "Cloning", scanning: "Scanning", triaging: "Triaging", planning: "Planning", fixing: "Fixing", verifying: "Verifying", done: "Done", error: "Stopped" }
const ORDER = ["cloning", "scanning", "triaging", "planning", "fixing", "verifying", "done"]
let timer
let startedAt = null
const seenIssues = new Set()
const seenLog = new Set()

function ts(t) { return new Date(t.endsWith("Z") ? t : t.replace(" ", "T") + "Z").getTime() }

function renderTracker(events, status) {
  const byStage = new Map()
  for (const e of [...events].reverse()) {
    const cur = byStage.get(e.stage) || { first: ts(e.ts), ms: 0 }
    cur.ms = Math.max(cur.ms, Number(e.duration_ms) || 0)
    byStage.set(e.stage, cur)
  }
  const current = status.stage === "verifying" ? "fixing" : status.stage
  const idx = ORDER.indexOf(current)
  const finished = status.stage === "done" || status.stage === "error"
  for (const li of document.querySelectorAll("#tracker li")) {
    const st = li.dataset.stage
    const i = ORDER.indexOf(st)
    const info = byStage.get(st)
    let state = "pending"
    if (finished) state = (st === "done" ? (status.stage === "done" ? "done" : "error") : info ? "done" : "skipped")
    else if (i < idx) state = info ? "done" : "skipped"
    else if (i === idx) state = "active"
    li.className = state
    const v = li.querySelector(".v")
    if (state === "active") {
      const live = info ? Math.max(0, (Date.now() - info.first) / 1000) : 0
      v.textContent = status.stage === "triaging" || status.stage === "fixing" || status.stage === "verifying" ? status.detail.replace(/^\w+ /, "") : `${live.toFixed(0)} s`
    } else if (state === "done" && info && info.ms) v.textContent = info.ms >= 1000 ? `${(info.ms / 1000).toFixed(1)} s` : `${info.ms} ms`
    else if (state === "skipped") v.textContent = "skipped"
    else v.textContent = ""
  }
}

function renderLog(events) {
  const log = $("#log")
  const items = [...events].reverse()
  for (const e of items) {
    const key = e.ts + e.stage + e.detail
    if (seenLog.has(key)) continue
    seenLog.add(key)
    const li = el("li", { class: `s-${e.stage}` },
      el("span", { class: "t", text: when(e.ts) }),
      el("span", { class: "st", text: e.stage }),
      el("span", { class: "d", text: e.detail }),
      e.duration_ms > 0 ? el("span", { class: "ms", text: Number(e.duration_ms) >= 1000 ? `${(e.duration_ms / 1000).toFixed(1)} s` : `${e.duration_ms} ms` }) : null,
    )
    log.prepend(li)
  }
  while (log.children.length > 40) log.lastElementChild.remove()
}

function tick(n, id) {
  const node = $(id)
  const from = Number(node.textContent) || 0
  if (from === n) return
  node.classList.remove("bump"); void node.offsetWidth; node.classList.add("bump")
  node.textContent = String(n)
}

async function load() {
  let d
  try { d = await getJSON(`api/scans/${encodeURIComponent(scan)}?t=${encodeURIComponent(t)}`) }
  catch (e) { $("#team").textContent = "Report not found"; $("#stage").hidden = true; $("#stage-detail").textContent = e.message; clearInterval(timer); return }
  document.title = `${d.scan.team} · Patchwork report`
  $("#team").textContent = d.scan.team
  $("#repo").textContent = d.scan.repo_url.replace("https://github.com/", "")
  $("#created").textContent = `Scan started ${when(d.scan.created_at)}`
  const st = d.status
  if (!startedAt) startedAt = ts(d.scan.created_at)
  const done = st.stage === "done" || st.stage === "error"
  $("#elapsed").textContent = done ? "" : `${Math.max(0, (Date.now() - startedAt) / 1000).toFixed(0)} s`
  renderTracker(d.events, st)
  renderLog(d.events)
  const fixingNow = d.events.find((e) => e.stage === "fixing" && e.detail.startsWith("fixing ") && e.detail.includes(":"))
  const fixingKey = fixingNow && st.stage !== "done" ? fixingNow.detail.slice(7) : null
  $("#stage-word").textContent = STAGE_WORD[st.stage] || st.stage
  $("#stage-detail").textContent = st.detail && st.stage !== "done" ? st.detail : st.stage === "done" ? "Everything below is final. Rescan any time." : ""
  $("#stage").className = `stage-line ${st.stage === "done" ? "done" : st.stage === "error" ? "error" : ""}`
  if (st.stage === "done" || st.stage === "error") clearInterval(timer)

  const ready = d.issues.filter((i) => i.fix?.status === "verified").length
  tick(d.issues.length, "#c-real"); tick(d.noise.length, "#c-noise"); tick(ready, "#c-ready"); tick(d.findings_total, "#c-findings")

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
  $("#issues").replaceChildren(...d.issues.map((i) => {
    const isNew = !seenIssues.has(i.finding_id); seenIssues.add(i.finding_id)
    const isFixing = fixingKey && `${i.path}:${i.line}` === fixingKey && i.fix?.status !== "verified"
    return el("li", { class: `${isNew ? "enter" : ""} ${isFixing ? "fixing" : ""}` }, el("a", { href: link(i) },
      el("span", { class: "t" }, el("span", { text: i.title }), sevChip(i.severity), el("span", { class: "chip noise", text: CLASS_LABEL[i.bug_class] || i.bug_class })),
      el("span", { class: "status" }, isFixing ? el("span", { class: "chip working" }, el("span", { class: "spin" }), "Fixing now") : statusChip(i)),
      el("span", { class: "why" }, el("span", { class: "loc", text: `${i.path}:${i.line}  ` }), i.why),
    ))
  }))
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
