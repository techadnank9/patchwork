# Findings in our own code

Semgrep Guardian ran alongside the coding agent while Patchwork was written. Everything it flagged in our own code, and what changed.

| File | Rule or concern | What we changed |
|---|---|---|
| public/*.html | Inline `<script type="module">` blocks violated the Content Security Policy (`default-src 'self'`). The browser blocked them. | Moved every page script into its own file and set an explicit `script-src 'self'`. No inline scripts anywhere. |
| lib/semgrep.mjs | Semgrep CLI invocation | Always `execFile` with an argument array, never a shell string. Target paths come from our own clone directory. |
| lib/repo.mjs | Path traversal risk when reading files Semgrep names | `safePath()` resolves `realpath` of both the clone root and the target and refuses anything outside the clone, before and after symlink resolution. Clones run with `core.symlinks=false`. |
| server.mjs | `withSource()` builds SQL by string replacement | The only values substituted are the fixed literals `room` and `sample`, chosen by the server, never by the request. All user supplied values go through `query_params`. |

Standout finding from a scanned repo: to be filled in once a team gives permission to show it.
