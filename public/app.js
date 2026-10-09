// Shared helpers. Everything from a repo or an agent goes through textContent, never innerHTML.
export const $ = (sel, root = document) => root.querySelector(sel)
export const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k === "class") node.className = v
    else if (k === "text") node.textContent = v
    else if (k === "html") throw new Error("innerHTML is not allowed")
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v === true ? "" : v)
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c.nodeType ? c : document.createTextNode(String(c)))
  return node
}
export const params = new URLSearchParams(location.search)
export async function getJSON(url, options) {
  const res = await fetch(url, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`)
  return body
}
export const fmtSecs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`)
export const fmtN = (n) => Number(n || 0).toLocaleString()
export const CLASS_LABEL = { injection: "Injection", secrets: "Secrets", auth: "Auth", packages: "Packages", crypto: "Crypto", other: "Other" }
export const SEV_WORD = { high: "High", medium: "Medium", low: "Low" }
export function ago(ts) {
  const d = new Date(ts.endsWith("Z") ? ts : ts.replace(" ", "T") + "Z")
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000)
  if (s < 60) return `${Math.round(s)} s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
export function when(ts) {
  const d = new Date(ts.endsWith("Z") ? ts : ts.replace(" ", "T") + "Z")
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}
export function copyButton(text, label = "Copy") {
  const b = el("button", { type: "button", text: label })
  b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; setTimeout(() => (b.textContent = label), 1500) }
    catch { b.textContent = "Select and copy" }
  })
  return b
}
export const icon = {
  check: () => svg("M3 8.5l3.2 3L13 4.5"),
  arrow: () => svg("M3 8h10M9 4l4 4-4 4"),
  copy: () => svg("M6 6h7v7H6zM3 10V3h7"),
  download: () => svg("M8 2v9M4 7l4 4 4-4M3 13h10"),
}
function svg(d) {
  const ns = "http://www.w3.org/2000/svg"
  const s = document.createElementNS(ns, "svg")
  s.setAttribute("viewBox", "0 0 16 16"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor")
  s.setAttribute("stroke-width", "1.8"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true")
  const p = document.createElementNS(ns, "path"); p.setAttribute("d", d); s.append(p)
  return s
}
export function statusChip(issue) {
  const f = issue.fix
  if (issue.fixed_in_rescan) return el("span", { class: "chip fixed", text: "Fixed" })
  if (f?.status === "verified") return el("span", { class: "chip ready", text: "Patch ready" })
  if (f?.status === "needs_human") return el("span", { class: "chip human", text: "Needs a human" })
  if (f?.status === "failed") return el("span", { class: "chip human", text: "Retrying" })
  return el("span", { class: "chip none", text: "Not attempted" })
}
export function sevChip(sev) {
  return el("span", { class: `chip ${sev}`, text: SEV_WORD[sev] || sev })
}
// Shared header with nav
export function header(current) {
  const links = [["index.html", "Board"], ["history.html", "History"], ["join.html", "Join"]]
  return el("header", { class: "top" },
    el("a", { class: "brand", href: "index.html" }, el("span", { class: "name", text: "Patchwork" }), el("span", { class: "tag", text: "Found, fixed, proven." })),
    el("nav", { class: "nav" }, ...links.map(([href, label]) => el("a", { href, text: label, "aria-current": current === href ? "page" : undefined }))),
  )
}
