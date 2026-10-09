import { $, el, params, getJSON, header, sevChip, copyButton, icon, fmtSecs } from "./app.js"
$("#hdr").replaceWith(header())
const scan = params.get("scan"), t = params.get("t"), fid = params.get("f")
$("#back").href = `report.html?scan=${encodeURIComponent(scan)}&t=${encodeURIComponent(t)}`
const d = await getJSON(`api/scans/${encodeURIComponent(scan)}?t=${encodeURIComponent(t)}`).catch((e) => { $("#title").textContent = "Not found"; throw e })
const i = [...d.issues, ...d.noise].find((x) => x.finding_id === fid)
if (!i) { $("#title").textContent = "Finding not found" } else {
  document.title = `${i.title} · Patchwork`
  $("#title").textContent = i.title
  $("#sub").replaceChildren(i.verdict === "noise" ? el("span", { class: "chip noise", text: "Ruled out as noise" }) : sevChip(i.severity), el("span", { class: "repo", text: `${i.path}:${i.line}` }), el("span", { text: i.rule_id }))
  const f = i.fix
  const verified = f?.status === "verified"
  const steps = [["Found", true], ["Patched", !!f && (verified || f.explanation)], ["Rescanned", !!f && (verified || f.finding_gone === 1 || f.error.includes("flags") || f.error.includes("new finding"))], ["Verified", verified]]
  $("#steps").replaceChildren(...steps.map(([w, on]) => el("span", { class: `pstep ${on ? "on" : "off"}` }, icon.check(), w)))
  $("#why").textContent = i.why
  if (i.fix_hint) { $("#hint").hidden = false; $("#hint").replaceChildren(el("b", { text: "Suggested change: " }), i.fix_hint) }
  $("#snippet").textContent = i.snippet
  if (verified) {
    $("#diff-sec").hidden = false
    $("#explain").textContent = f.explanation
    renderDiff(f.diff)
    const proofs = [
      ["Rescan", f.finding_gone ? "finding gone" : "still flagged", f.finding_gone ? "good" : "bad"],
      ["New issues", String(f.new_issues), Number(f.new_issues) === 0 ? "good" : "bad"],
      ["Found to fixed", fmtSecs(f.latency_ms), "good"],
      ["Syntax", f.syntax_ok ? "checked" : "not checked", f.syntax_ok ? "good" : "na"],
    ]
    $("#proofs").replaceChildren(...proofs.map(([k, v, c]) => el("div", { class: `proof ${c}` }, el("span", { class: "v", text: v }), el("span", { class: "k", text: k }))))
    $("#memory").hidden = !Number(f.memory_hit)
    if (i.variant && Number(i.variant.projects) > 1) { $("#variant").hidden = false; $("#variant").replaceChildren(el("b", { text: `Same bug found in ${Number(i.variant.projects) - 1} other project${Number(i.variant.projects) - 1 === 1 ? "" : "s"}.` }), " One finding here led us to the same rule firing elsewhere in the room.") }
    $("#cmd").append(copyButton("git apply patchwork.patch"))
    $("#dl").href = `api/scans/${encodeURIComponent(scan)}/patch?t=${encodeURIComponent(t)}`
  } else if (i.verdict === "real") {
    $("#nofix-sec").hidden = false
    $("#nofix").textContent = i.covered ? "A verified patch to the same file already removed this finding. Semgrep no longer reports it after that patch, so no separate fix was needed." : !f ? "The fixer has not reached this issue yet, or the per-repo fix limit was hit. The plan above still tells you what to change." : f.status === "needs_human" ? `Two attempts did not pass verification. Last reason: ${f.error}. A person should make this change.` : `Attempt ${f.attempt} did not pass: ${f.error}. Retrying.`
  }
  const links = []
  if (i.triage_session) links.push(el("a", { href: i.triage_session, target: "_blank", rel: "noopener", text: "Triage session on Guild" }))
  if (f?.session_url) links.push(el("a", { href: f.session_url, target: "_blank", rel: "noopener", text: "Fix session on Guild" }))
  $("#links").replaceChildren(...links)
}
function renderDiff(text) {
  const pre = $("#diff")
  pre.replaceChildren(...text.split("\n").map((line) => {
    let cls = "ctx", body = line
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) { cls = "hdr" }
    else if (line.startsWith("@@")) cls = "hunk"
    else if (line.startsWith("+")) { cls = "add"; body = line.slice(1) }
    else if (line.startsWith("-")) { cls = "del"; body = line.slice(1) }
    else if (line.startsWith(" ")) body = line.slice(1)
    return el("span", { class: `ln ${cls}`, text: body })
  }))
}
