const { chromium } = require("playwright")
const path = require("path")
const L = "http://localhost:3000"
const ECOM = `${L}/report.html?scan=a1aa18fb-02ec-4597-9aa6-173726284aa2&t=e31566aea7564bbdcc7da60a4b80fb90`
const FIX = `${L}/fix.html?scan=31956afe-ecdc-405b-b101-9e2bed5c90c4&t=def2ab548fe5aba95321e9f4c114e92b&f=17ec06ed-b6b6-41f6-9c2f-8feee2bd7f17`
const card = (n) => "file://" + path.resolve(__dirname, "cards", n)
const D = { s1_why: 14.8, s2_what: 9.9, s3_join: 9.8, s4_report: 25.3, s5_proof: 23.5, s6_room: 15.2, s7_stack: 21.3, s8_cta: 11.6 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function glide(page, to, ms) { await page.evaluate(([to, ms]) => new Promise((res) => { const from = scrollY, t0 = performance.now(); const step = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k+2, 2)/2; scrollTo(0, from + (to - from) * e); k < 1 ? requestAnimationFrame(step) : res() }; requestAnimationFrame(step) }), [to, ms]) }
async function toEl(page, sel, ms, off = 90) { const y = await page.evaluate(([s, o]) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + scrollY - o : scrollY }, [sel, off]); await glide(page, y, ms) }
const scenes = {
  s1_why: async (p) => { await p.goto(card("why.html")); await sleep(D.s1_why * 1000) },
  s2_what: async (p) => { await p.goto(L + "/"); await sleep(3500); await toEl(p, ".pulse", 2200, 260); await sleep(1500); await toEl(p, "#live-room", 2200, 60); await sleep(1200) },
  s3_join: async (p) => { await p.goto(L + "/join.html"); await sleep(1200); await p.click("#team"); await p.keyboard.type("Night Owls", { delay: 70 }); await sleep(300); await p.click("#repo"); await p.keyboard.type("github.com/techadnank9/demo-ecom-store".replace(/^/, "https://"), { delay: 30 }); await sleep(500); await p.click("#pub"); await sleep(800); await p.click("#guided"); await sleep(1500); await p.hover("#go"); await sleep(1800) },
  s4_report: async (p) => { await p.goto(ECOM); await sleep(4500); await toEl(p, "#repomap", 2500); await sleep(4500); await toEl(p, "#graph-sec", 2500); await sleep(3500); await toEl(p, "#plan-sec", 2500); await sleep(3000); await toEl(p, "#issues", 2500); await sleep(1500) },
  s5_proof: async (p) => { await p.goto(FIX); await sleep(3000); await toEl(p, "#diff-sec", 2500); await sleep(5000); await toEl(p, "#proofs", 2000, 300); await sleep(4500); await p.goto("https://github.com/techadnank9/patchwork-demo-app/pull/2"); await sleep(5500) },
  s6_room: async (p) => { await p.goto(L + "/board.html"); await sleep(7500); await p.goto(L + "/history.html"); await sleep(1500); await toEl(p, ".proj", 2500); await sleep(3000) },
  s7_stack: async (p) => { await p.goto(card("stack.html")); await sleep(D.s7_stack * 1000) },
  s8_cta: async (p) => { await p.goto(card("cta.html")); await sleep(D.s8_cta * 1000 + 800) },
}
;(async () => {
  const browser = await chromium.launch()
  const only = process.argv[2]
  for (const [id, fn] of Object.entries(scenes)) {
    if (only && id !== only) continue
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: path.join(__dirname, "clips", id), size: { width: 1920, height: 1080 } }, colorScheme: "dark" })
    const page = await ctx.newPage()
    const t0 = Date.now()
    try { await fn(page) } catch (e) { console.log("scene error", id, e.message) }
    const pad = D[id] * 1000 - (Date.now() - t0); if (pad > 0) await sleep(pad + 400)
    await ctx.close()
    console.log("recorded", id, ((Date.now() - t0) / 1000).toFixed(1) + "s")
  }
  await browser.close()
})()
