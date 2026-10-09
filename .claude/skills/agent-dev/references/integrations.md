# Integrations, Delegation, and the Coding Agent

Read this when picking the tools an agent will use, wiring up an MCP
integration, delegating to another agent, or driving the coding container.

## Common integrations

An _integration_ gives the agent tools to interact with the world. Each one is
a separate `@guildai-services/*` package: add it to `package.json`, then
`import` it.

| Service        | Package                                    | Export               | Tool Name Prefix  |
| -------------- | ------------------------------------------ | -------------------- | ----------------- |
| Azure DevOps   | `@guildai-services/guildai~azure-devops`   | `azureDevOpsTools`   | `azure_devops_`   |
| Bitbucket      | `@guildai-services/guildai~bitbucket`      | `bitbucketTools`     | `bitbucket_`      |
| Cypress        | `@guildai-services/guildai~cypress`        | `cypressTools`       | `cypress_`        |
| GitHub         | `@guildai-services/guildai~github`         | `gitHubTools`        | `github_`         |
| Google Compute | `@guildai-services/guildai~google-compute` | `googleComputeTools` | `google_compute_` |
| Google Logging | `@guildai-services/guildai~google-logging` | `googleLoggingTools` | `google_logging_` |
| Guild          | `@guildai/agents-sdk`                      | `guildTools`         | `guild_`          |
| Jira           | `@guildai-services/guildai~jira`           | `jiraTools`          | `jira_`           |
| Linear         | `@guildai-services/guildai~linear`         | `linearTools`        | `linear_`         |
| NewRelic       | `@guildai-services/guildai~newrelic`       | `newrelicTools`      | `newrelic_`       |
| Slack          | `@guildai-services/guildai~slack`          | `slackTools`         | `slack_`          |
| TestRail       | `@guildai-services/guildai~testrail`       | `testrailTools`      | `testrail_`       |
| User Interface | `@guildai/agents-sdk`                      | `userInterfaceTools` | `ui_`             |
| Zendesk        | `@guildai-services/guildai~zendesk`        | `zendeskTools`       | `zendesk_`        |

`guild integration list` shows the full set.

## MCP integrations

Third-party integrations are packaged under any `@guildai-services/<owner>~<name>`
scope, not just `guildai`, and follow a slightly different naming convention:

| Convention  | First-party example                | MCP example                         |
| ----------- | ---------------------------------- | ----------------------------------- |
| Package     | `@guildai-services/guildai~github` | `@guildai-services/attio~attio-mcp` |
| Export      | `gitHubTools` (camelCase)          | `AttioMcpTools` (PascalCase)        |
| Tool prefix | `github_`                          | `attio_mcp_`                        |

How the names are derived:

1. Take the integration name: `attio-mcp`
2. Replace hyphens with underscores → `attio_mcp` (this is also the tool prefix,
   e.g. `attio_mcp_search_records`)
3. Capitalise each `_`-separated word → `AttioMcp`
4. Append `Tools` → **`AttioMcpTools`**

```bash
npm install --save @guildai-services/attio~attio-mcp
```

```typescript
'use agent';

import { agent, pick } from '@guildai/agents-sdk';
import { AttioMcpTools } from '@guildai-services/attio~attio-mcp'; // PascalCase, not camelCase

const tools = {
  ...pick(AttioMcpTools, ['attio_mcp_search_records', 'attio_mcp_get_record']),
};

type Tools = typeof tools;

async function run(input: Input, task: Task<Tools>): Promise<Output> {
  const records = await task.tools.attio_mcp_search_records({ query: 'Acme' });
  // ...
}
```

## Discovering tool names

**NEVER guess a tool's name.** Use the CLI:

```bash
guild integration list                                  # all integrations
guild integration operation list guildai~github         # operations for one
guild integration operation list guildai~github --json  # full input/output schemas
```

Tool names follow `{service_prefix}_{operation_name}` (e.g. `github_pulls_get`).
For an integration not in the table above, the prefix is the _integration name_
with hyphens replaced by underscores.

Once installed, use the TypeScript LSP to get exact parameter and return types,
or read the types in `node_modules` directly. Let TypeScript help you:

- Let the compiler infer the type of `tools` — DO NOT annotate it explicitly.
- NEVER cast to `any`. Unresolved types mean something else is wrong; keep
  investigating.

## Agent-to-agent delegation

Every published agent exposes a `/tool` sub-package, auto-generated at build
time, that makes it callable like any other tool. It inherits the agent's
`inputSchema` and `outputSchema`, so callers get full type safety.

The generated tool definition imports the agent module to read those schemas.
That import traverses the agent's complete module graph: prompts, templates,
JSON, and other assets imported by `agent.ts` must be copied into `dist`,
included by `package.json.files`, and supported by an esbuild loader. Copying an
asset into `dist` does not publish it when `files` excludes its extension.

For an agent designed to be called through `/tool`, prefer a side-effect-free
`schemas.ts` plus a checked-in `tooldef.ts`. Guild preserves an existing tool
definition instead of generating one that imports `agent.ts`:

```typescript
// schemas.ts
import { z } from 'zod';

export const inputSchema = z.object({ text: z.string() });
export const outputSchema = z.object({ result: z.string() });
```

```typescript
// tooldef.ts
import { guildAgentTool } from '@guildai/agents-sdk';
import { z } from 'zod';
import { inputSchema, outputSchema } from './schemas.js';

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export default guildAgentTool<Input, Output>({
  description: 'Processes text.',
  inputSchema,
  outputSchema,
  calls: '@guildai/acme~processor',
});
```

Import the same schemas from `agent.ts`, keep both descriptions aligned, and
ensure `package.json` exports `./tool` from `./dist/tooldef.js`.

Add the dependency:

```json
"@guildai/waterson~subagent": "^1.0.0"
```

Then import from `/tool`:

```typescript
import subagentTool from '@guildai/waterson~subagent/tool';

// In an llmAgent:
export default llmAgent({
  description: 'My agent',
  tools: { subagent: subagentTool },
  systemPrompt: '...',
});

// In an automatic state agent:
const result = await task.tools.subagent({ type: 'text', text: 'do the thing' });

// In a self-managed state agent:
return callTools([
  {
    type: 'tool-call',
    toolName: 'subagent',
    toolCallId: 'subagent-1',
    input: { type: 'text', text: 'do the thing' },
  },
]);
```

Callers should import `/tool`; do not recreate another agent's definition with
`guildAgentTool()`. The publishing agent may use `guildAgentTool()` in its own
checked-in `tooldef.ts` to keep that exported boundary independent of
`agent.ts`.

Sub-agent calls are tool calls, so they compose with `task.gather` — calling
the same sub-agent N times concurrently needs no extra agent in between. See
SKILL.md.

## Using the coding agent

The coding agent runs instructions inside a dedicated (but isolated) virtual
machine with full access to the computer: use it when your agent needs to
read/write files, run shell commands, or work with a cloned repository.

```typescript
import { ExperimentalCodingTools as codingTools } from '@guildai-services/guildai~experimental-coding';
import { type Task, agent } from '@guildai/agents-sdk';
import {
  CONTAINER_IMAGE,
  codingAgentToolsFrom,
} from '@guildai/guildai~sys-experimental-coding';
import codingAgentTool from '@guildai/guildai~sys-experimental-coding/tool';

const tools = { ...codingTools, communicate: codingAgentTool };
type Tools = typeof tools;

async function run(input: Input, task: Task<Tools>): Promise<Output> {
  const { container_id } = await task.tools.experimental_coding_create({
    image: CONTAINER_IMAGE,
  });
  try {
    const { text } = await task.tools.communicate({
      container_id,
      message: 'What files are in the current directory?',
    });
    return { type: 'text', text };
  } finally {
    await task.tools.experimental_coding_delete({ container_id });
  }
}
```

**Container lifecycle** — You own the container. Create it before you need it,
and always clean up in a `finally` block so you don't leave containers running
if your agent throws.

**System prompts** — Pass a `system_prompt` to `communicate` to shape how the
coding agent behaves. Keep it in a separate `.md` file (see the project
reference on external prompts).

```typescript
import systemPrompt from './system-prompt.md';

const { text } = await task.tools.communicate({
  container_id,
  system_prompt: systemPrompt,
  message,
});
```

**Giving the coding agent tools** — The container is sandboxed and can't reach
external services. Pass tools explicitly using `codingAgentToolsFrom`:

```typescript
import { pick } from '@guildai/agents-sdk';
import { gitHubTools } from '@guildai-services/guildai~github';
import { codingAgentToolsFrom } from '@guildai/guildai~sys-experimental-coding';

const { text } = await task.tools.communicate({
  container_id,
  message,
  tools: codingAgentToolsFrom({
    ...pick(gitHubTools, [
      'github_repos_download_zipball_archive',
      'github_pulls_create',
    ]),
  }),
});
```

Only pass the tools the coding agent actually needs for the task at hand.

**Multi-turn conversations** — By default each `communicate` call starts a
fresh session. To continue a conversation, capture the `session_id` from the
first response and pass it back:

```typescript
// Step 1: set up the environment
const { text: setupResult, session_id } = await task.tools.communicate({
  container_id,
  message: 'Clone the repo and set up the workspace',
  tools: codingAgentToolsFrom({
    ...pick(gitHubTools, ['github_repos_download_zipball_archive']),
  }),
});

// Step 2: do the actual work, continuing the same session
const { text } = await task.tools.communicate({
  container_id,
  session_id,
  message: 'Now implement the feature described above',
  tools: codingAgentToolsFrom({
    ...pick(gitHubTools, ['github_pulls_create']),
  }),
});
```

Using `session_id` preserves the container's working directory, environment
variables, and conversation history between calls.

**GitHub tools for common container tasks** — The GitHub API provides
primitives that must be composed in the container. Include the tools each task
depends on:

| Task                | Required Tools                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clone a repository  | `github_repos_download_zipball_archive`                                                                                                                |
| Create a branch     | `github_git_get_ref`, `github_git_create_ref`                                                                                                          |
| Create a commit     | `github_git_get_ref`, `github_git_get_commit`, `github_git_create_blob`, `github_git_create_tree`, `github_git_create_commit`, `github_git_update_ref` |
| Create a PR         | `github_pulls_create`                                                                                                                                  |
| Create an issue     | `github_issues_create`                                                                                                                                 |
| Comment on issue/PR | `github_issues_create_comment`                                                                                                                         |
| Compute a PR diff   | `github_pulls_list_files`                                                                                                                              |

## Using an LLM from within a coded agent

For agents that need an LLM tool-calling loop with fine-grained control over
which tool calls the LLM handles and which get delegated to the runtime:

```typescript
import {
  agent,
  callTools,
  output,
  delegatedCallsOf,
  asToolResultContent,
  userInterfaceTools,
  type ModelMessage,
  type Task,
  type AgentResult,
  type TypedToolResult,
  type TypedToolError,
} from '@guildai/agents-sdk';
import { gitHubTools } from '@guildai-services/guildai~github';
import { slackTools } from '@guildai-services/guildai~slack';
import { z } from 'zod';

const tools = { ...gitHubTools, ...slackTools, ...userInterfaceTools };
type Tools = typeof tools;

// Separate tools the LLM can execute directly from those needing delegation
const llmTools = { ...gitHubTools }; // LLM gets execute access to these
const agentTools = { ...slackTools, ...userInterfaceTools }; // These get delegated

async function start(input, task: Task<Tools>) {
  const messages: ModelMessage[] = [{ role: 'user', content: input.text }];

  const result = await task.llm.generateText({
    system: 'You are a helpful assistant.',
    messages,
    tools: llmTools, // Only give LLM the tools it can execute
  });

  // Check for delegated (unexecuted) tool calls
  const delegated = delegatedCallsOf<Tools>(result.content);
  if (delegated.length > 0) {
    // Save conversation state for onToolResults
    await task.save({ messages: [...messages, ...result.response.messages] });
    return callTools(delegated);
  }

  return output({ type: 'text', text: result.text });
}

async function onToolResults(
  results: Array<TypedToolResult<Tools> | TypedToolError<Tools>>,
  task: Task<Tools>
) {
  const state = await task.restore();
  // Convert results back into LLM message format
  state.messages.push({
    role: 'tool',
    content: asToolResultContent(results),
  });

  // Continue the conversation
  // ...
}
```

Key utilities:

- `task.llm.generateText({ messages, system, tools })` — make one model call
  with automatic authentication and provider selection. It does not feed tool
  results back to the model; write that loop yourself when the model must use a
  result and continue, or use `llmAgent()` for a managed loop.
- `delegatedCallsOf<Tools>(content)` — extracts unexecuted tool calls from
  `generateText` results that need runtime delegation.
- `asToolResultContent(results)` — converts `TypedToolResult[]` into LLM
  message format for conversation history.

## Posting to Slack

Convert markdown to Slack's mrkdwn format with an inline converter
(`slackify-markdown` is CJS and breaks in the ESM agent runtime):

```typescript
// Simple markdown-to-Slack-mrkdwn converter (inline — do NOT use slackify-markdown)
function slackifyMarkdown(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, '*$1*') // bold: **text** → *text*
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_') // italic: *text* → _text_
    .replace(/~~(.+?)~~/g, '~$1~') // strikethrough
    .replace(/^### (.+)$/gm, '*$1*') // h3 → bold
    .replace(/^## (.+)$/gm, '*$1*') // h2 → bold
    .replace(/^# (.+)$/gm, '*$1*') // h1 → bold
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>') // links
    .replace(/^> (.+)$/gm, '> $1') // blockquotes (same syntax)
    .replace(/`([^`]+)`/g, '`$1`'); // inline code (same syntax)
}

const slackText = slackifyMarkdown('## Summary\n- Item 1\n- Item 2');
await task.tools.slack_chat_post_message({ channel: 'C1234567890', text: slackText });
```
