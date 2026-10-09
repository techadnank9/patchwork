---
name: guild-agent-development
description: Local agent development using the Guild CLI. Activated when user mentions creating agents, guild agent commands, saving/publishing agents, or agent development workflow. Handles proper CLI workflow and prevents direct git operations.
---

# Guild Agent Development

Build agents for Guild using the CLI.

This file covers the whole authoring path: the workflow, how to pick a pattern,
and how to write the code. Details you only need occasionally live in
`references/`, next to this file:

| Read                         | When                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `references/compiler.md`     | A `"use agent"` agent fails to build, or misbehaves after resuming. Full compiler limitation list. |
| `references/integrations.md` | Choosing integrations, MCP naming, delegating to another agent, driving the coding container.      |
| `references/project.md`      | `package.json`, external prompts, versioning, the full CLI command list, troubleshooting.          |

The Guild CLI is also self-documenting:

- You may type `--help` after any command to learn more about how to use it
- `guild --help` lists common options available across all commands
- If you discover a discrepancy between these instructions and the Guild CLI's
  internal documentation, assume that the Guild CLI's version is correct

When using the CLI, prefer to explicitly provide arguments as defaults can
sometimes be unintuitive.

**Always use the Guild CLI for agent operations — unless specified below, never
use raw git commands.**

## When to Use This

Activate when the user:

- Mentions "guild agent" commands
- Wants to create, save, or publish an agent
- Is working in an agent directory
- Mentions agent development workflow
- Asks about agent versioning or publishing
- Wants to build a new agent

---

## Workflow

### Create or clone

```bash
# Create and initialize a new agent (interactive — prompts for name and template)
guild agent init

# Create with a specific name and template. You must specify an owner account.
guild agent init --owner account-name --name my-agent --template LLM --category development
guild agent init --owner account-name --name my-agent --template AUTO_MANAGED_STATE --category development
guild agent init --owner account-name --name my-agent --template BLANK --category development

# Fork or clone an existing agent
guild agent init --fork owner~agent-name
guild agent clone owner~agent-name
```

IMPORTANT! When creating a new agent, understand who will own it — typically an
organization the user belongs to, or the user's own private account. If unsure,
ask for clarification!

IMPORTANT! `guild agent init` creates the agent in the current working
directory, and `guild agent clone` in an `<agent-name>` directory. Use
`--directory` to specify an alternate location.

### Build

```bash
# Pull remote changes (e.g., edits from other collaborators)
guild agent pull

# Save the agent directory as a new version (creates a draft)
guild agent save --message "Description of changes"

# Save and wait for validation
guild agent save --message "Fix bug" --wait

# Save, validate, and publish
guild agent save --message "Release v1.0" --wait --publish
```

### Building

An agent is just an `npm` TypeScript project.

```bash
npm install     # install the agent's dependencies
npm run build   # build the agent's code
```

IMPORTANT! You must be logged in to Guild to `npm install` dependencies; run
`guild auth login` if you get a "not authorized" error.

TIP. Once you've identified the integrations your agent will depend on, update
`package.json` and run `npm install` _before_ writing any code that uses them.
You're much less likely to make a poor assumption about what tools exist or how
to use them.

Commit `package-lock.json` together with `package.json`. On save, Guild checks
that the lockfile is tracked and synchronized before enabling reproducible
dependency installs. If the CLI reports a missing or stale lock, run
`npm install`, add both package files to Git, and save again. Do not add
`package-lock.json` to `.gitignore`. Lockfile formats the CLI does not support
fall back to legacy dependency installation with a warning.

IMPORTANT! Always make sure your agent builds correctly before testing.

### Test

An agent must be tested with the `guild` tool, which uploads it to the server
runtime where it will actually operate.

```bash
guild agent test          # interactive test using the working directory
guild agent chat "Hello"  # single input
```

See `references/project.md` for pre-bundled and JSON-input testing, and for
what to do when no workspace has the credentials your agent needs.

### Save

`guild agent save` uploads the agent directory to Guild and creates a version —
no git commit or push is needed. Files matching `.gitignore`, plus `.git`,
`.guild`, `node_modules`, `dist`, and `.env*`, are excluded. Change detection and
a conflict check use a local `.guild/state.json` file.

A first save without local state compares files with the latest committed
version before bumping. Matching files recover their base and save normally.
Differing files are listed with the remote version; review them before confirming
an interactive overwrite or passing `--force` in a script.
New `init`, `clone`, and `fork` checkouts record their starting version for subsequent edits.

`guild agent pull` downloads the latest saved version through the API without git.
It preserves local edits to files unchanged remotely and refuses conflicting
changes before writing. Back up or reconcile the named files, or use
`guild agent pull --force` to accept the conflicting remote changes. Other local
edits and untracked files remain. Temporary test/chat versions are not pulled.

```bash
guild agent pull                                   # sync remote changes first
guild agent save --message "Description of changes"

guild agent save --message "Fix bug" --wait        # save and wait for validation
guild agent save --message "Release v1.0" --wait --publish

# Overwrite even if someone saved a newer version since your last save
guild agent save --message "Fix bug" --force
```

### The CLI is the only tool for agent operations

**ALL agent work — creating, saving, testing, debugging, investigating — goes
through the Guild CLI.**

- ✅ `guild agent init`, `guild agent clone`
- ✅ `guild agent save --message "desc"` (upload the agent directory and create a version)
- ✅ `guild agent pull` (sync remote changes into local directory)
- ✅ `guild agent test`, `guild agent chat`
- ✅ `guild agent versions|capabilities|code|get|grep <id>` to investigate
- ❌ NEVER use `git clone`, `gh repo`, or direct API calls for agent source
- ❌ NEVER manually create `package.json`, `tsconfig.json`, or `guild.json`

If the Guild CLI can't do something, **STOP and tell the user**: what you need
to do, why the CLI can't do it, and why you think `gh`/`git` is needed. Let the
user decide — never reach for `gh`/`git` on your own.

---

## SDK Essentials

### Network isolation

**Guild agents run in a network-isolated sandbox. They cannot make outbound
HTTP requests.** Direct calls to `fetch()`, `axios`, `node:http`, or any other
networking API will fail at runtime — including custom tools whose `execute`
function calls `fetch()`.

**All external API access must go through integrations.** Integrations are
platform-managed proxies that make authenticated HTTP requests on the agent's
behalf, outside the sandbox. The agent calls integration tools via
`task.tools.*`; the platform handles the network call and credential injection.

```typescript
// ❌ WRONG: fetch() is blocked — the agent has no network access
const response = await fetch('https://api.github.com/repos/owner/repo/pulls');

// ✅ CORRECT: use an integration
import { pick } from '@guildai/agents-sdk';
import { gitHubTools } from '@guildai-services/guildai~github';

const tools = { ...pick(gitHubTools, ['github_pulls_list']) };
const pulls = await task.tools.github_pulls_list({ owner, repo, state: 'open' });
```

If no published integration exists for the API you need, create one with
`guild integration create` (see the integrations skill for the full workflow).

### Imports and tool access

The SDK core comes from `@guildai/agents-sdk`. Service tools are in separate
`@guildai-services/*` packages — see `references/integrations.md` for the
catalog and naming rules. **Never guess a tool name**; discover it with
`guild integration operation list <integration>`.

To use an integration: import its tools, include the ones you need in the
agent's tool set, then call them on `task.tools`.

```typescript
const tools = {
  ...pick(gitHubTools, ['github_pulls_get']),
  ...pick(slackTools, ['slack_chat_post_message']),
};
type Tools = typeof tools;

const pr = await task.tools.github_pulls_get({ owner, repo, pull_number: 123 });
await task.tools.slack_chat_post_message({ channel: 'C1234567890', text: 'Hello!' });
```

Give an agent the **minimum set of tools** it needs. Many models have strict
limits on tool count, and unnecessary tools waste context and invite confusion.
Use `pick` to select and `omit` to exclude. NEVER spread an entire toolset
(e.g. `...gitHubTools`) in an LLM agent.

### Task properties

| Property               | Description                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `task.tools`           | Primary API for calling all tools                                                   |
| `task.gather()`        | Await tool calls concurrently, fail-fast — see below                                |
| `task.gatherSettled()` | Await tool calls concurrently and report each outcome — see below                   |
| `task.sessionId`       | Session ID for correlating operations                                               |
| `task.llm`             | LLM service — `generateText` makes one model call; see `references/integrations.md` |
| `task.env`             | Workspace variables; reading an unset key throws                                    |
| `task.console`         | Debug logging — requires `consoleTools`, and calls must be awaited                  |
| `task.save()`          | Persist agent state (self-managed state agents only)                                |
| `task.restore()`       | Retrieve previously saved state (self-managed state agents only)                    |
| `task.guild`           | **Deprecated** — use `task.tools.guild_*` instead                                   |
| `task.ui`              | **Deprecated** — use `task.tools.ui_*` instead                                      |

#### `task.env` — workspace variables

Keys are uppercase identifiers, set per workspace with
`guild workspace variable set KEY=value --workspace <owner>~<workspace>`. This is
the only per-workspace signal an agent gets: the published bundle is identical
everywhere and the trigger payload carries no workspace identity, so a variable
is how one agent serves a test workspace and a production one from the same
version.

**Reading a key that has no value throws** — it never returns `undefined`, so
`??` and `?.` do not help you; the getter runs before either can apply. Wrap the
read in `try`/`catch` and decide what the absent case means.

```typescript
let env = 'prod';
try {
  env = task.env.MY_AGENT_ENV;
} catch {
  // unset — fall back deliberately rather than crashing the turn
}
```

Values are resolved when the task dispatches or resumes, so treat a mid-task
edit as taking effect on the next resume at the earliest.

#### `task.console` needs `consoleTools`

`task.console` is dispatched as a `console_log` tool call, so the toolset must
include `consoleTools` or the calls go nowhere. Nothing catches this at compile
time — the property is always present on the type — and a silently logless agent
is a miserable thing to debug. **Await the calls**, too; they are tool
dispatches, not `console.log`.

```typescript
import { consoleTools, userInterfaceTools } from '@guildai/agents-sdk';

const tools = { ...consoleTools, ...userInterfaceTools };
await task.console.info('this reaches the debug console');
```

### Guild skills

Guild skills are account-scoped Markdown instructions, not integration
packages. Do not add a dependency such as
`@guildai-services/acme~brand-voice`, and do not import a per-skill
`SkillsTools` export. Instead, opt the agent into the skills runtime once by
including `skillsTools` from `@guildai/agents-sdk`. It exposes `skills_search`
(metadata-only catalog) and `skills_activate` (loads one skill body into the
conversation).

Skills are knowledge-only. If something needs API access, executable code,
credentials, or a dedicated tool set, build an integration or agent instead.

---

## Choosing a Pattern

Decide this before writing code. There are three patterns, and the answer is
usually #1 or #2.

| What you're building                                    | Use                                                |
| ------------------------------------------------------- | -------------------------------------------------- |
| Conversational, prompt-driven, the LLM _is_ the logic   | **#1 `llmAgent`**                                  |
| Deterministic logic, a sequence of tool calls, webhooks | **#2 `agent` + `"use agent"`**                     |
| The same work over N inputs, concurrently               | **#2, with `task.gather`** — not a second agent    |
| Long-running work that suspends and resumes             | **#2** — that is what the compiler is for          |
| Explicit control over every conversational turn         | #3 self-managed state — rare, and hard to maintain |

Considerations when #1 and #2 both fit:

- **Maintenance.** An LLM agent is easiest for a human to understand. A coded
  agent requires expert knowledge; one with explicit state management is a
  state machine that is difficult even for an expert to maintain.
- **Cost and latency.** An LLM agent requires inference, so it incurs a high
  per-invocation cost and non-trivial latency. If the task is simple, a coded
  agent is cheaper.
- **Control.** An LLM agent is stochastic. If you need precise, fine-grained
  control, code is easier than natural-language instructions.
- **Judgment.** An LLM agent allows nuanced judgment calls; a coded agent
  requires strict rules.

TIP. A coded agent can call `task.llm.generateText` to use an LLM as a
subroutine — often a reasonable trade-off.

**One agent, one job.** Don't split work across two agents to work around a
perceived limitation. Fan-out in particular is not a reason: `task.gather`
handles it inside a single compiled agent (below). Reach for a second agent
when it is genuinely a separate, independently useful capability.

---

## 1. LLM Agent (`llmAgent()`) — Simplest

For conversational/prompt-driven agents where the LLM IS the logic.

```typescript
import { llmAgent, pick } from '@guildai/agents-sdk';
import { gitHubTools } from '@guildai-services/guildai~github';

export default llmAgent({
  description: 'Helps users with GitHub questions',
  tools: {
    ...pick(gitHubTools, ['github_issues_list_for_repo', 'github_issues_get']),
  },
  systemPrompt: `
    You are a helpful assistant that answers questions about GitHub repositories.
    Use the GitHub tools to look up information when asked.
  `,
  mode: 'one-shot', // "one-shot" (default) or "multi-turn"
  useWorkspaceAgents: false,
});
```

**Structured inputs.** By default `llmAgent` accepts `{ type: "text", text:
string }` and sends `text` as the first user message. Override with
`inputSchema` (a Zod schema for the agent's input) and `inputTemplate` (a
Mustache-style template that renders the input as the initial LLM user message,
default `"{{text}}"`):

```typescript
export default llmAgent({
  description: 'Analyzes a GitHub repository',
  inputSchema: z.object({
    repo: z.string().describe('Repository in owner/repo format'),
    branch: z.string().default('main'),
  }),
  inputTemplate: 'Analyze repo {{repo}} on branch {{branch}}',
  tools: { ...pick(gitHubTools, ['github_repos_get', 'github_pulls_list']) },
  systemPrompt: 'You analyze GitHub repositories.',
  mode: 'one-shot',
  useWorkspaceAgents: false,
});
```

**`mode`.** `one-shot` runs for a single turn — which may include rounds of
tool calls and thinking — then returns its output and restores control to the
caller. This is appropriate for most agents, and is what you want for fully
autonomous operation.

`multi-turn` does not return control automatically; it proceeds interactively,
prompting the user, until a termination criterion that you must specify
exactly, at which point you instruct the agent to call the `__submit__` tool.
WARNING: this is **rarely** the right mode. It is **only** useful for agents
guaranteed to be invoked interactively. USE WITH CAUTION!

**`useWorkspaceAgents`.** When `true`, the agent dynamically discovers and can
call other agents installed in the workspace (like Guild's built-in assistant
does). Defaults to `true`, but most agents should explicitly set it to `false`
unless they need dynamic discovery. For deterministic orchestration, delegate
to a specific agent by importing its published `/tool` sub-package.

IMPORTANT! Understand whether your agent will operate interactively. An agent
activated from a trigger — a webhook or a timer — is **non-interactive**, since
no user is present. In a non-interactive agent, **NEVER** use `ui_prompt`: it
solicits a response from a user who will not be there.

---

## 2. Coded Agent with Automatic State Management

A TypeScript `run` function. Ideal for most situations that require code.

- Implement a single `run()` that accepts the input and returns the output, in
  a natural procedural style that is easy to understand and maintain.
- Requires the `"use agent"` directive at the top of the file: this triggers a
  compilation step that converts the TypeScript into a resumable state machine
  which can suspend for long-running tasks.
- Use `task.tools.*` for all integration tool calls.

```typescript
'use agent';

import { type Task, agent, pick, userInterfaceTools } from '@guildai/agents-sdk';
import { gitHubTools } from '@guildai-services/guildai~github';
import { z } from 'zod';

const inputSchema = z.object({
  type: z.literal('text'),
  text: z.string().describe('Repository in owner/repo format'),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  type: z.literal('text'),
  text: z.string().describe('Summary of open PRs'),
});

type Output = z.infer<typeof outputSchema>;

const tools = {
  ...pick(gitHubTools, ['github_search_issues_and_pull_requests']),
  ...userInterfaceTools,
};

type Tools = typeof tools;

async function run(input: Input, task: Task<Tools>): Promise<Output> {
  const repo = input.text.trim();

  const results = await task.tools.github_search_issues_and_pull_requests({
    q: `is:pr is:open repo:${repo}`,
    per_page: 20,
  });

  if (!results.items?.length) {
    return { type: 'text', text: `No open PRs found in ${repo}` };
  }

  const summary = results.items
    .map((pr) => `- #${pr.number}: ${pr.title} (by ${pr.user?.login})`)
    .join('\n');

  return { type: 'text', text: `## Open PRs in ${repo}\n\n${summary}` };
}

export default agent({
  description: 'Lists open PRs in a GitHub repository',
  inputSchema,
  outputSchema,
  tools,
  run,
});
```

### Doing several things at once: `task.gather`

**A compiled agent fans out with `task.gather` / `task.gatherSettled`.** The
runtime allocates every subtask atomically, dispatches them as a single batch,
suspends the state machine while they run, and assembles the results in source
order on resume. This is the supported way to run independent tool calls
concurrently, and it is the answer whenever you need the same work done over N
inputs.

`task.gather` is analogous to `Promise.all`: results in source order, rejects
on the first failure.

```typescript
const [pulls, issues] = await task.gather([
  task.tools.github_pulls_list({ owner, repo, state: 'open' }),
  task.tools.github_issues_list_for_repo({ owner, repo, state: 'open' }),
]);
```

Over a list, build the calls with a plain `for` loop:

```typescript
const calls = [];
for (const pr of prs) calls.push(task.tools.review_pr({ owner, repo, number: pr }));
const reviews = await task.gather(calls);
```

`task.gatherSettled` is analogous to `Promise.allSettled`: it never rejects, so
one failing call doesn't sink the rest.

```typescript
const results = await task.gatherSettled(calls);
for (const result of results) {
  if (result.status === 'fulfilled') {
    task.console.info(`got ${result.value.full_name}`);
  } else {
    task.console.warn(`failed: ${result.reason}`);
  }
}
```

Rules:

- **Inputs must be tool-call expressions** — `task.tools.X(...)`, sub-agent
  tool calls, or hook tools. The `ToolCallPromise` brand on the parameter type
  rejects arbitrary promises (`fetch(...)`, timers, library code) at compile
  time. That boundary is exactly what makes `gather` work where `Promise.all`
  can't: every input is a dispatchable tool call the runtime can serialize, not
  an opaque promise.
- Results are fully typed: `task.gather([a, b])` returns a tuple whose elements
  are the awaited return types of `a` and `b`, in order.
- Use it only from a compiled (`"use agent"`) body. Self-managed-state agents
  already fan out by returning `callTools([...])` with more than one entry.
- ❌ `Promise.all` over `task.tools.X(...)` does not work — it hides the
  tool-call promises inside a plain promise, so the runtime never sees them and
  never suspends to dispatch them. ✅ `task.gather` is the replacement.
- Sub-agent `/tool` calls are tool calls, so calling one sub-agent N times
  concurrently needs no orchestrator agent in between.

### Compiler gotchas worth knowing up front

The compiler supports most JavaScript, but a handful of constructs either fail
the build or — worse — compile cleanly and misbehave after the agent suspends
and resumes. The five that come up most:

1. **Don't hold a `Promise` in a local across an `await`.** Frame slots must be
   serializable. Await where you create it.
2. **Don't pass an `async` arrow to `.map` / `setTimeout` / `Promise.all`.** The
   compiled descriptor gets invoked as a plain function and throws. Use a `for`
   loop, and `task.gather` for concurrency.
3. **No `async function*`, no labeled `break`/`continue`, no two nested
   functions sharing a name.** These fail at build time.
4. **Keep async helpers in the same file as the agent.** The compiler only
   processes that one file. Pure-sync helpers may live elsewhere.
5. **Push heavy pure computation into synchronous helpers.** Compiled loops
   burn a metered step budget; a sync helper runs off the meter, and its
   intermediates never get serialized.

`try` / `catch` around a tool call works: a rejected call is delivered to the
innermost enclosing `catch` and execution continues past it, so an agent can
retry, fall back, or degrade around a failing call.

**Full list, with error signatures and workarounds: `references/compiler.md`.**
Read it when a build fails or an agent misbehaves after resuming.

---

## 3. Coded Agent with Self-Managed State

For explicit control over each turn. Rare — reach for it only when patterns #1
and #2 genuinely cannot express what you need.

- Implement `start()` and `onToolResults()`, returning `AgentResult<Output, Tools>`
  - `return ask(prompt)` — sends a `ui_prompt` tool call to get user input
  - `return output(value)` — wraps your output as `{ type: "output", output: value }`
  - `return callTools([...])` — requests the runtime to execute tool calls
- `task.save(state)` / `task.restore()` persist state between invocations; you
  must explicitly specify the state schema.
- No `"use agent"` directive, since there is no compilation step — none of the
  compiler limitations apply.
- Generally results in a much more complicated program that is difficult to
  understand and maintain. Avoid if possible.

**Fanning out is not a reason to choose this pattern.** Compiled `"use agent"`
agents invoke multiple tools or sub-agents in parallel with `task.gather`.

```typescript
import {
  agent,
  ask,
  output,
  callTools,
  userInterfaceTools,
  type Task,
  type AgentResult,
  type TypedToolResult,
  type TypedToolError,
} from '@guildai/agents-sdk';
import { z } from 'zod';

const inputSchema = z.object({
  type: z.literal('text'),
  text: z.string().describe("The user's input"),
});

const outputSchema = z.object({
  type: z.literal('text'),
  text: z.string().describe("The agent's response"),
});

const stateSchema = z.object({
  count: z.number(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;
type State = z.infer<typeof stateSchema>;
const tools = { ...userInterfaceTools };
type Tools = typeof tools;

async function start(
  input: Input,
  task: Task<Tools, State>
): Promise<AgentResult<Output, Tools>> {
  await task.save({ count: 1 });
  return ask(`Got: ${input.text}`);
}

async function onToolResults(
  results: Array<TypedToolResult<Tools> | TypedToolError<Tools>>,
  task: Task<Tools, State>
): Promise<AgentResult<Output, Tools>> {
  const state = await task.restore();
  const result = results[0];
  if (result.type === 'tool-result' && result.output.text === 'done') {
    return output({ type: 'text', text: `Final count: ${state!.count}` });
  }
  await task.save({ count: state!.count + 1 });
  return ask(`Count: ${state!.count + 1}`);
}

export default agent({
  description: 'Tracks conversation state explicitly',
  inputSchema,
  outputSchema,
  stateSchema,
  tools,
  start,
  onToolResults,
});
```

---

## Calling Another Agent

Every published agent exposes a `/tool` sub-package, auto-generated at build
time, that makes it callable like any other tool. It inherits the agent's
`inputSchema` and `outputSchema`, so callers get full type safety. Add the
dependency, then import the default export from `/tool`:

```typescript
import subagentTool from '@guildai/waterson~subagent/tool';

const tools = { subagent: subagentTool };

// In a compiled agent:
const result = await task.tools.subagent({ type: 'text', text: 'do the thing' });
```

The default generated `/tool` imports the agent module, so every transitively
imported asset must be copied into `dist` and included by
`package.json.files`. For an agent designed for delegation, prefer shared
schemas plus a checked-in `tooldef.ts` that imports only those schemas. See
`references/integrations.md` for the complete publishing pattern.

Callers should import `/tool` instead of recreating another agent's definition
with `guildAgentTool()`. A publishing agent may use `guildAgentTool()` in its
own checked-in `tooldef.ts`. Full detail, including the LLM-agent and
self-managed-state forms: `references/integrations.md`.

---

## Anti-Hallucination Guide

**Only use methods and patterns that actually exist.** Discover tool names with
`guild integration operation list <integration>` — never guess.

```typescript
// ❌ WRONG: agents are network-isolated — fetch/axios/http calls are blocked
await fetch("https://api.github.com/repos/owner/repo/pulls")
const res = await axios.get("https://api.github.com/repos/owner/repo/pulls")

// ❌ WRONG: a tool with an execute function that calls fetch() will also fail
const httpTool = tool({
  description: "Make HTTP request",
  inputSchema: z.object({ url: z.string() }),
  execute: async ({ url }) => fetch(url).then(r => r.json()),  // blocked at runtime
})

// ❌ WRONG: splitting work into a second agent to get concurrency.
// A compiled agent fans out with task.gather — see Pattern #2.
const { results } = await task.tools.my_fanout_agent({ items })

// ❌ WRONG: Promise.all cannot dispatch tool calls — use task.gather
const results = await Promise.all(items.map(i => task.tools.github_pulls_get(i)))

// ❌ WRONG: identifier is deprecated
export default agent({ identifier: "my-agent", ... })

// ❌ WRONG: service tools are NOT in @guildai/agents-sdk
import { gitHubTools } from "@guildai/agents-sdk"
import { slackTools } from "@guildai/agents-sdk"

// ❌ WRONG: these direct service accessors don't exist
const pr = await task.github.search_issues(...)
await task.slack.post_message(...)
const issue = await task.jira.get_issue(...)

// ❌ WRONG: these methods don't exist
task.github.pulls_list()
task.github.repos_get()
task.github.pulls_create()

// ❌ WRONG: parameter name
github_search_issues_and_pull_requests({ query: "..." })  // Use { q: "..." }

// ❌ WRONG: task.ui_prompt() is not a method on task
await task.ui_prompt("What repo?")

// ❌ WRONG: importing service tools from internal packages directly
import { gitHubTools } from "@guildai-services/guildai~github/src/service"

// ❌ WRONG: missing "use agent" directive on coded agents
import { agent } from "@guildai/agents-sdk"
// (no "use agent" at top)
export default agent({ run: async (input, task) => { ... } })

// ❌ WRONG: MCP integrations export PascalCase, not camelCase
import { attioMcpTools } from "@guildai-services/attio~attio-mcp"

// ❌ WRONG: hand-rolling service tools in an agent.
// guildServiceTool is for AUTHORING an integration package, NOT for agents.
// Discover with `guild integration list`, then import the published package.
import { guildServiceTool } from "@guildai/agents-sdk"
const calTool = guildServiceTool("google-calendar-oauth", { endpoint: { /* ... */ } }) // NO
```

```typescript
// ✅ No identifier needed
export default agent({ description: "My agent", ... })

// ✅ Service tools from @guildai-services/* packages
import { gitHubTools } from "@guildai-services/guildai~github"
import { slackTools } from "@guildai-services/guildai~slack"

// ✅ Platform tools from @guildai/agents-sdk
import { guildTools, userInterfaceTools } from "@guildai/agents-sdk"

// ✅ Use task.tools.* for all tool calls
const pr = await task.tools.github_pulls_get({ owner, repo, pull_number })
const results = await task.tools.github_search_issues_and_pull_requests({ q: "is:pr repo:owner/name" })
await task.tools.slack_chat_post_message({ channel, text })
const response = await task.tools.ui_prompt({ type: "text", text: "What repo?" })

// ✅ Concurrency inside one compiled agent
const calls = []
for (const i of items) calls.push(task.tools.github_pulls_get(i))
const pulls = await task.gather(calls)

// ✅ "use agent" directive for coded agents
"use agent"
import { agent } from "@guildai/agents-sdk"
export default agent({ run: async (input, task) => { ... } })

// ✅ MCP integrations export PascalCase, not camelCase
import { AttioMcpTools } from "@guildai-services/attio~attio-mcp"
```

Let TypeScript help you: let the compiler infer the type of `tools` (DO NOT
annotate it explicitly — the annotation is likely wrong), and NEVER cast to
`any`. Failure to resolve correct types means something else is going wrong, so
keep investigating. Adding a tool to the agent's `tools` creates the correct
signature on `task.tools`, so calls should never resolve to `any`.
