import { $, getJSON, header } from "./app.js"
$("#hdr").replaceWith(header("join.html"))
const form = $("#f"), msg = $("#msg"), go = $("#go")
if (new URLSearchParams(location.search).get("mode") === "guided") $("#guided").checked = true
form.addEventListener("submit", async (e) => {
  e.preventDefault()
  msg.className = ""; msg.textContent = ""
  const team = $("#team").value.trim(), repo_url = $("#repo").value.trim()
  if (!team) return fail("Team name is required")
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test(repo_url)) return fail("That does not look like a GitHub repo link")
  go.disabled = true; go.textContent = "Queuing…"
  try {
    const r = await getJSON("api/scans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team, repo_url, is_public: $("#pub").checked, guided: $("#guided").checked }) })
    msg.className = "ok"; msg.textContent = "Queued. Opening your private report…"
    setTimeout(() => location.assign(r.report_url), 700)
  } catch (err) {
    fail(err.message); go.disabled = false; go.textContent = "Scan my repo"
  }
})
function fail(t) { msg.className = "err"; msg.textContent = t }
