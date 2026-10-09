// TEST FIXTURE for Patchwork. Flaw: a hardcoded signing secret (fake value).
import jwt from "jsonwebtoken"

const SESSION_SIGNING_SECRET = "change-me-fixture-secret-0123456789abcdef"

export function signSession(user) {
  return jwt.sign({ sub: user.id }, SESSION_SIGNING_SECRET, { expiresIn: "7d" })
}
