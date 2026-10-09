import { $, getJSON, header, fmtN } from "./app.js"
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
pulse(); setInterval(pulse, 5000)
