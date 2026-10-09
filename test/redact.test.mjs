import test from "node:test"
import assert from "node:assert/strict"
import { redact } from "../lib/redact.mjs"

// Fake values are assembled at runtime so no token-shaped literal sits in the repo.
const j = (...parts) => parts.join("")
const fakes = {
  openai: j("sk-proj-", "abcdefghijklmnopqrstuvwxyz0123456789"),
  stripe: j("sk_live_", "4eC39HqLyjWDarjtT1zdp7dc"),
  github: j("ghp_", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123"),
  ghpat: j("github_pat_", "11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz"),
  aws: j("AKIA", "IOSFODNN7EXAMPLE"),
  slack: j("xoxb-", "123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx"),
  google: j("AIza", "SyA-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAK"),
}

test("masks known token shapes, keeps first 4 chars", () => {
  for (const [name, value] of Object.entries(fakes)) {
    const out = redact(`const x = "${value}"`)
    assert.ok(!out.includes(value), `${name} still present`)
    assert.ok(out.includes(value.slice(0, 4) + "…[masked]"), `${name} prefix missing: ${out}`)
  }
})

test("masks quoted values assigned to secret-like names", () => {
  const cases = [
    'API_KEY = "zzzzzzzzzzzzzzzzzzzzzzzzzz"',
    "db_password: 'hunter2hunter2hunter2hunter2'",
    'const accessToken = `aaaaaaaaaaaaaaaaaaaaaaaaaaaa`',
    'PASSWD="qwertyqwertyqwertyqwerty"',
  ]
  for (const c of cases) {
    const out = redact(c)
    assert.ok(out.includes("…[masked]"), `not masked: ${out}`)
    assert.ok(!/[a-z0-9]{20,}/i.test(out.replace(/…\[masked\]/g, "")), `value leaked: ${out}`)
  }
})

test("leaves short values and ordinary code alone", () => {
  const src = 'const name = "patchwork"\npassword = "changeme"\nreturn fetch(url)'
  assert.equal(redact(src), src)
})

test("masks private key blocks", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nABCDEF\n-----END RSA PRIVATE KEY-----"
  const out = redact(pem)
  assert.ok(!out.includes("MIIEow"))
  assert.ok(out.includes("…[masked]"))
})
