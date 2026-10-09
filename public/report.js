import { $, el, params, getJSON, header, sevChip, statusChip, copyButton, when, CLASS_LABEL, bars, SEV_COLOR, CLASS_COLOR } from "./app.js"
$("#hdr").replaceWith(header())
const scan = params.get("scan"), t = params.get("t"), t_ = t
const STAGE_WORD = { queued: "Queued", cloning: "Cloning", scanning: "Scanning", triaging: "Triaging", planning: "Planning", fixing: "Fixing", verifying: "Verifying", done: "Done", error: "Stopped", waiting: "Waiting for you" }
const RUN_WORD = { triage: "Run triage", plan: "Write the fix plan", fix: "Fix and verify" }
const WAIT_STAGE = { triage: "triaging", plan: "planning", fix: "fixing" }
$("#run").addEventListener("click", async () => {
  const b = $("#run"); b.disabled = true; b.textContent = "Starting…"
  try { await getJSON(`api/scans/${encodeURIComponent(scan)}/continue?t=${encodeURIComponent(t)}`, { method: "POST" }) } catch (e) { b.textContent = e.message; b.disabled = false; return }
  setTimeout(load, 400)
})
const ORDER = ["cloning", "scanning", "triaging", "planning", "fixing", "verifying", "done"]
let timer
let startedAt = null
let mermaidMod = null
let lastTreeKey = ""
async function repoMap() {
  try {
    const t = await getJSON(`api/scans/${encodeURIComponent(scan)}/tree?t=${encodeURIComponent(t_)}`)
    if (!t.available) return
    const key = JSON.stringify(t.flagged) + t.dirs.length
    if (key === lastTreeKey) return
    lastTreeKey = key
    $("#repomap").hidden = false
    $("#rm-meta").textContent = `${t.dirs.length} top-level folders · ${t.flagged.length} file${t.flagged.length === 1 ? "" : "s"} flagged`
    const q = (x) => '"' + String(x).replace(/"/g, "'") + '"'
    const id = (x) => "n" + Math.abs([...x].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36)
    const lines = ["flowchart LR", `  ROOT[${q(t.repo)}]:::root`]
    const dirIds = new Map()
    for (const d of t.dirs) {
      const langs = Object.entries(d.langs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ")
      const nid = id("dir:" + d.name)
      dirIds.set(d.name, nid)
      lines.push(`  ${nid}[${q(d.name + "/\n" + d.files + " files" + (langs ? " · " + langs : ""))}]:::dir`)
      lines.push(`  ROOT --> ${nid}`)
    }
    if (t.root_files) { lines.push(`  RF[${q(t.root_files + " files at root")}]:::dir`); lines.push("  ROOT --> RF") }
    for (const f of t.flagged) {
      const top = f.path.includes("/") ? f.path.split("/")[0] : null
      const parent = top && dirIds.has(top) ? dirIds.get(top) : t.root_files ? "RF" : "ROOT"
      const cls = f.real ? "bad" : f.pending ? "wait" : "ok"
      const label = f.path.split("/").pop() + "\n" + (f.real ? `${f.real} real${f.classes.length ? " · " + f.classes.join(", ") : ""}` : f.pending ? `${f.pending} triaging` : `${f.noise} noise`)
      lines.push(`  ${id("f:" + f.path)}[${q(label)}]:::${cls}`)
      lines.push(`  ${parent} --> ${id("f:" + f.path)}`)
    }
    lines.push("  classDef root fill:#f2b33d,stroke:#f2b33d,color:#1a1304,font-weight:bold")
    lines.push("  classDef dir fill:#221f1a,stroke:#3a3528,color:#f3eee3")
    lines.push("  classDef bad fill:#3a1410,stroke:#ff5a4e,color:#ffc9c4")
    lines.push("  classDef wait fill:#2a1d0a,stroke:#f2b33d,color:#f4d79a")
    lines.push("  classDef ok fill:#1b1915,stroke:#8f877a,color:#c9c1b0")
    if (!mermaidMod) {
      mermaidMod = (await import("./vendor/mermaid.esm.min.mjs")).default
      mermaidMod.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict", flowchart: { curve: "basis", nodeSpacing: 24, rankSpacing: 40, htmlLabels: false }, themeVariables: { fontFamily: "IBM Plex Sans", background: "#15130f", primaryColor: "#221f1a", lineColor: "#8f877a", primaryTextColor: "#f3eee3" } })
    }
    const { svg } = await mermaidMod.render("rm-svg-" + Date.now(), lines.join("\n"))
    const wrap = $("#rm-diagram")
    wrap.replaceChildren()
    // Mermaid's SVG can contain HTML line breaks, so parse it as HTML and lift out the <svg>.
    const doc = new DOMParser().parseFromString(svg, "text/html")
    const node = doc.querySelector("svg")
    if (node) wrap.append(document.adoptNode(node))
  } catch (e) { console.warn("repo map", e.message) }
}
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
  const current = status.stage === "verifying" ? "fixing" : status.stage === "waiting" ? WAIT_STAGE[status.detail] || status.stage : status.stage
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
      v.textContent = status.detail ? status.detail.replace(/^(cloning|cloned|running|triaging|triaged|planning|fixing|verifying) ?/, "") || `${live.toFixed(0)} s` : `${live.toFixed(0)} s`
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
  if (d.events.some((e) => e.stage === "scanning")) repoMap()
  const fixingNow = d.events.find((e) => e.stage === "fixing" && e.detail.startsWith("fixing ") && e.detail.includes(":"))
  const fixingKey = fixingNow && st.stage !== "done" ? fixingNow.detail.slice(7) : null
  const waiting = d.waiting
  $("#stage-word").textContent = waiting ? "Waiting for you" : STAGE_WORD[st.stage] || st.stage
  $("#stage-detail").textContent = waiting ? ({ triage: "Semgrep is done. Ask the triage agent which findings are real.", plan: "Triage is done. Ask the planner for an ordered fix plan.", fix: "Plan is ready. Let the fixer patch our copy and prove each change." })[waiting] : st.detail && st.stage !== "done" ? st.detail : st.stage === "done" ? "Everything below is final. Rescan any time." : ""
  const run = $("#run")
  if (waiting) { run.hidden = false; run.disabled = false; run.textContent = RUN_WORD[waiting] || "Run" } else run.hidden = true
  $("#stage").classList.toggle("waiting", !!waiting)
  $("#stage").className = `stage-line ${st.stage === "done" ? "done" : st.stage === "error" ? "error" : ""}`
  if (st.stage === "done" || st.stage === "error") clearInterval(timer)

  const ready = d.issues.filter((i) => i.fix?.status === "verified").length
  tick(d.issues.length, "#c-real"); tick(d.noise.length, "#c-noise"); tick(ready, "#c-ready"); tick(d.findings_total, "#c-findings")

  if (d.issues.length) {
    $("#graph-sec").hidden = false
    const byClass = {}, bySev = {}
    for (const i of d.issues) { byClass[i.bug_class] = (byClass[i.bug_class] || 0) + 1; bySev[i.severity] = (bySev[i.severity] || 0) + 1 }
    $("#g-class").replaceChildren(bars(byClass, { colorFor: (k) => CLASS_COLOR[k] || "var(--gray)", labelFor: (k) => CLASS_LABEL[k] || k }))
    $("#g-sev").replaceChildren(bars(bySev, { colorFor: (k) => SEV_COLOR[k] || "var(--gray)", labelFor: (k) => ({ high: "High", medium: "Medium", low: "Low" })[k] || k }))
    const top = Object.entries(byClass).sort((a, b) => b[1] - a[1])[0]
    const highs = bySev.high || 0
    $("#g-note").replaceChildren(el("b", { text: `Patch order: ` }), d.plan ? `follow the ${d.plan.steps?.length || 0} steps below, top to bottom. ` : "the plan appears as soon as the planner finishes. ", highs ? `${highs} high severity issue${highs === 1 ? "" : "s"} first; ` : "", top ? `most of the risk is ${CLASS_LABEL[top[0]] || top[0]} (${top[1]} issue${top[1] === 1 ? "" : "s"}).` : "")
  }
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
      el("span", { class: "status" }, isFixing ? el("span", { class: "chip working" }, el("span", { class: "spin" }), "Fixing now") : statusChip(i), i.pr_url ? el("a", { class: "chip fixed prlink", href: i.pr_url, target: "_blank", rel: "noopener", text: "PR #" + i.pr_url.split("/").pop() }) : null),
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
    const prAll = $("#pr-all")
    if (d.pr_possible && !prAll.dataset.wired) {
      prAll.hidden = false; prAll.dataset.wired = "1"
      prAll.addEventListener("click", async () => {
        prAll.disabled = true; prAll.textContent = "Opening pull requests…"; $("#pr-msg").textContent = ""
        try {
          const r = await getJSON(`api/scans/${encodeURIComponent(scan)}/pr?t=${encodeURIComponent(t)}`, { method: "POST" })
          const ok = r.results.filter((x) => x.ok).length
          $("#pr-msg").textContent = `${ok} of ${r.results.length} pull request${r.results.length === 1 ? "" : "s"} opened${r.results.some((x) => !x.ok) ? ". " + r.results.filter((x) => !x.ok).map((x) => `${x.path}: ${x.error}`).join("; ") : "."}`
          prAll.textContent = "Pull requests opened"
          load()
        } catch (e) { $("#pr-msg").textContent = e.message; prAll.disabled = false; prAll.textContent = "Open a pull request for each fix" }
      })
    }
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
