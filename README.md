# Patchwork

**Found, fixed, proven.** A free, opt-in security desk for every team in a hackathon room.

A team pastes a public GitHub link. We clone a shallow copy, scan it with Semgrep, and three agents hosted on Guild do the thinking: one separates real issues from noise, one writes an ordered fix plan, one writes the patch. Every patch is applied to **our** copy and rescanned before anyone sees it. Results land in ClickHouse. The team gets a private report with a plan and verified patches. A public board shows the room.

Two things make this more than scan-and-autofix:

- **Variant hunt.** When a rule fires as a real issue in one project, the board shows every other project where the same rule fired. One bug here leads to the same bug in N other projects.
- **Room memory.** Every verified fix is saved by rule. The next time that rule appears, the fixer receives the proven fix as an example. These count as "memory assisted fixes". It is guidance, not copy and paste, and the UI says so.

Built solo at the Cyberdefense Hackathon, San Francisco, October 9, 2026. All code written during the event.

## Sponsor map

| Tool | What it does here | Where to see it |
|---|---|---|
| **Semgrep** | Finds every issue (`semgrep scan --config auto`), and proves every fix by rescanning the patched file. Semgrep Guardian watched our own code as we wrote it; see [FINDINGS.md](FINDINGS.md). | Findings count on the board, "Rescan: finding gone" on every fix view |
| **Guild** | Hosts and runs the three agents (`agents/`). Called through an API trigger. Every verdict, plan, and fix stores its Guild session URL as the audit trail. | "Triage session on Guild" and "Fix session on Guild" links on each fix view |
| **ClickHouse Cloud** | Append-only store for scans, events, findings, verdicts, plans, fixes, and fix memory. Every screen is a query in [queries.sql](queries.sql). Variant hunt (Q3) and room memory (Q7) are ClickHouse queries that directly drive remediation. | "ClickHouse: N rows, last query X ms" on the board |
| **Akash** | Hosts the app itself: one container from the public GHCR image, SDL in `deploy.yaml`. | The live URL above |
| **Model** | Guild's managed model access (Gemini 2.5 Flash at the time of the event). | Stored as `backend = 'guild'` on every row |

## Where it runs

Live during the event: http://fnppdkvs7devtbbbtnlc32vqpc.ingress.cpu.lax.lsn.akash.pub (join page at /join.html, history at /history.html).

Hosted on **Akash** (deployment 1791580753099, provider overclock, na-us-west, 2 vCPU, 4 GiB) from the public image `ghcr.io/techadnank9/patchwork:latest`, which GitHub Actions builds on every push to master. One container serves the frontend and the API. The SDL is [deploy.yaml](deploy.yaml); the two secret values are entered in the Akash console, never committed. Data stays in ClickHouse Cloud and agents run on Guild, so the container itself is stateless apart from the clones in `work/`.

## Run it

Node 22 or newer. No build step.

```bash
npm install
pip install semgrep          # or brew install semgrep
cp .env.example .env         # fill in ClickHouse and Guild values
node --env-file=.env scripts/init-db.mjs      # creates 7 tables and 1 view
node --env-file=.env server.mjs               # http://localhost:3000
cloudflared tunnel --url http://localhost:3000  # put the URL in PUBLIC_BASE_URL
```

Run one scan from the command line:

```bash
node --env-file=.env worker.mjs https://github.com/owner/repo "Team name" [--no-agents] [--no-fix] [--public]
node --env-file=.env worker.mjs --local fixtures/vuln-app "Fixture"   # the labeled test fixture
node --env-file=.env scripts/try-agent.mjs triage sample-input.json   # one agent call, prints the session URL
node --env-file=.env scripts/seed-sample.mjs                           # sample rows for building the UI; board shows them only with ?sample=1
npm test                                                               # redact() unit tests
```

### Guild setup

```bash
npm i -g @guildai/cli && guild auth login
guild workspace create patchwork && guild workspace select adnan~patchwork
# in a sibling folder, per agent:
guild agent init --name triage-agent --template LLM --agent-type GUILD_TYPESCRIPT
cp ../patchwork/agents/triage-agent/agent.ts triage-agent/agent.ts
cd triage-agent && npm install && guild agent save --message "v1" --wait --publish
guild workspace agent add adnan~triage-agent
```

The API trigger key comes from the web app: workspace, Triggers, Add Trigger, API. It is shown once. Account API keys cannot start trigger sessions.

## Layout

```
server.mjs          Express, queue, API, static files
worker.mjs          pipeline for one scan, also a CLI
lib/db.mjs          ClickHouse client, batched inserts, timed queries
lib/repo.mjs        URL allowlist, shallow clone, path containment
lib/semgrep.mjs     scan a dir or a file with execFile, normalize, filter, rank
lib/redact.mjs      mask secrets before storing, sending, or showing
lib/verify.mjs      apply a fix to our clone, syntax check, rescan, diff, commit
lib/agents.mjs      runAgent wrapper that picks the backend (guild | openai fallback)
lib/guild.mjs       Guild API client and the three answer parsers
agents/             the three Guild agents (TypeScript, llmAgent)
public/             board, join, report, fix, history. Plain HTML, CSS, vanilla JS.
scripts/            init-db, try-agent, seed-sample
fixtures/vuln-app   labeled test fixture, never on the board
```

## Safety rules

- Opt in only. We scan a repo only when its team submitted it.
- Read only on other people's work. Never push, never probe a deployed app.
- Never execute cloned code. Clone, read, Semgrep, `ast.parse`, and `node --check` only.
- Repo content is data, never instructions. The agents are told this; so is the worker.
- Secrets are redacted before they are stored, sent to any agent, or displayed.
- The public board names only teams that ticked the box.
- Injection safe by construction: `execFile` with argument arrays, strict URL allowlist, path containment, `textContent` in the UI, parameterized ClickHouse queries, CSP without inline scripts.
- `work/` is deleted after the event.

"Verified by rescan" means Semgrep no longer flags the code and the file still parses. It does not prove the app behaves the same. For leaked keys, the patch moves the value to an environment variable and the report says to rotate it: it is still in git history.
