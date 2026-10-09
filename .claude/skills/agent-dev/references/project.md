# Project Layout, Packaging, and CLI Reference

Read this when setting up or repairing a project: `package.json`, external
prompts, versioning, the full CLI command list, and troubleshooting.

## File structure

After `guild agent init`:

```
my-agent/
├── .git/              # Git repo (remote is Guild server)
├── .gitignore         # Includes guild.json
├── agent.ts           # Your agent code (default location; can also be in src/)
├── package.json       # Dependencies
├── tsconfig.json      # TypeScript config
└── guild.json         # Agent ID (gitignored, local only)
```

## package.json

Agents that use `"use agent"` need the Babel compiler to transform
`await task.tools.*` calls into continuations. New agent templates include this
by default. The `bundle` script must be separate from and run _after_ the
`build` step — don't merge them.

```json
{
  "name": "guild-agent-{name}",
  "version": "1.0.0",
  "author": "Guild.ai",
  "type": "module",
  "scripts": {
    "build": "npm run build:compile && npm run build:transform && npm run build:copy",
    "build:compile": "tsc --build",
    "build:transform": "babel ./dist/agent.js --out-dir ./dist --out-file-extension .compiled.js --plugins @guildai/babel-plugin-agent-compiler",
    "build:copy": "cp *.md dist/",
    "bundle": "npm run build && esbuild dist/agent.compiled.js --bundle --loader:.md=text --platform=node --format=esm --external:zod --external:@guildai/agents-sdk | gzip | base64 > agent.js.gz"
  },
  "dependencies": {},
  "devDependencies": {
    "@babel/cli": "^7.28.3",
    "@guildai/babel-plugin-agent-compiler": "*",
    "esbuild": "^0.25.0",
    "typescript": "^5.0.0"
  }
}
```

For simple `llmAgent()` agents that don't use `"use agent"`, skip the Babel
step:

```json
{
  "scripts": {
    "build": "tsc",
    "bundle": "npm run build && esbuild dist/agent.js --bundle --loader:.md=text --platform=node --format=esm --external:zod --external:@guildai/agents-sdk | gzip | base64 > agent.js.gz"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "typescript": "^5.0.0"
  }
}
```

**CRITICAL:**

- DO NOT modify the `@guildai/agents-sdk` and `zod` dependencies provided in the
  agent's template.
- You may add third-party ESM-compatible packages your agent uses to
  `dependencies`.
- DO NOT include CJS packages: an agent that includes a CJS module will fail at
  runtime.
- `devDependencies` is for build tools only (`esbuild` for bundling,
  `typescript` for compilation).

Add integrations and agents-as-tools with `npm install --save`, as
`dependencies` (not `devDependencies`):

```bash
npm install --save @guildai-services/some-owner~some-integration
npm install --save @guildai/some-owner~some-agent
```

## External prompts

Don't embed long prompts as strings in your code — import them as `.md` files.

```typescript
import { llmAgent } from '@guildai/agents-sdk';
import systemPrompt from './system-prompt.md';

export default llmAgent({
  description: 'My agent',
  systemPrompt,
  tools: {
    /* ... */
  },
});
```

Your editor treats `.md` files as first-class citizens: syntax highlighting,
preview, spell-check. Long prompt strings buried in TypeScript get none of
that, and they make the surrounding logic harder to read.

The `--loader:.md=text` flag in the bundle script handles importing `.md` files
at build time. Guild's server-side build applies its own text-loader whitelist
that you can't override from your local `bundle` script. It reads these
extensions as text: `.md`, `.org`, `.txt`, `.yaml`, `.html`, and `.css`.
Importing any other extension will fail the server build (`No loader is
configured for ".<ext>" files`) even if your local `bundle` script configures a
loader for it. Note that `.json` is imported as a parsed object (esbuild's
default loader), not as text.

## Versioning

- Use semver: `1.0.0` → `1.0.1` (patch), `1.1.0` (minor), `2.0.0` (breaking)
- Use `--bump [patch|minor|major]` with `guild agent save` to auto-bump
  `package.json` version
- Or bump manually in `package.json` before saving

Version lifecycle:

1. **Draft** — After `guild agent save` (no `--publish`)
2. **Validating** — After `--publish`, running validation
3. **Published** — Validation passed, available for use
4. **Failed** — Validation failed, check errors

## MCP vs CLI

If Guild MCP tools are available (check for tools prefixed with `guild_`), use
them for **read operations**: searching agents, listing workspaces, reading
contexts, checking sessions, viewing credentials. MCP tools are faster and
don't require shell execution.

Use the **CLI** for **local development operations**: `guild agent init`,
`guild agent save`, `guild agent test`, `guild agent pull`, `guild agent
clone`. These involve the local filesystem and git, which MCP can't do.

## CLI commands

- Use `guild help` to discover the full set of commands
- Use `guild <command> [...<subcommand>] --help` for full documentation
- Prefer to explicitly provide all command arguments rather than relying on
  defaults

```bash
guild setup                                        # Install coding assistant skills
guild setup --agents-md                            # Also create AGENTS.md template
guild agent init                                   # Create and initialize a new agent
guild agent init --name <name> --template LLM      # Create with specific name and template
guild agent init --fork <agent-id>                 # Fork existing agent
guild agent pull                                   # Pull remote changes
guild agent save                                   # Upload the agent directory and create a draft version
guild agent save --message "description"           # Upload with an inline summary
guild agent save --message "v1.0" --wait --publish # Save + validate + publish
guild agent save --bump minor --message "v1.1"     # Auto-bump version before saving
guild agent test                                   # Interactive test (ephemeral build from the working directory)
guild agent test --bundle agent.js.gz              # Test with pre-built bundle
guild agent test --no-cache                        # Force fresh build (skip cache)
guild agent chat "Hello"                           # Test with input
guild agent get [agent-id]                         # View agent info
guild agent capabilities [agent-id]                # Show resolved tools for an agent
guild agent list                                   # List agents
guild agent list --search "github" --published     # Search published agents
guild agent search <query>                         # Search published agents
guild agent versions [agent-id]                    # Version history
guild agent diff [agent-id]                        # Show changes between agent versions or working copy
guild agent log [agent-id]                         # Show runtime execution logs
guild agent clone <agent-id>                       # Clone existing agent
guild agent fork [identifier]                      # Fork an agent (latest published version, or identifier:version)
guild agent publish                                # Publish a version
guild agent unpublish                              # Remove from catalog
guild agent archive [agent-id]                     # Archive an agent
guild agent unarchive [agent-id]                   # Unarchive an archived agent
guild agent update [identifier]                    # Update agent metadata
guild agent workspaces [agent-id]                  # List workspaces using an agent
guild agent categories                             # List agent categories and their allowed tags
guild agent tags list|add|remove|set               # Manage agent tags
guild agent init ... --tags code-review,testing    # Optional tags at creation (must be allowed by the category)
guild agent fork ... --tags code-review            # Optional tags on fork (default: source tags when category inherited)
guild agent revalidate                             # Re-run validation
guild agent code [agent-id]                        # View agent source
guild agent grep <pattern>                         # Search agent code files for a regex pattern
guild agent grep <pattern> --published             # Search only published agents
guild agent owners                                 # List accounts that can own agents
guild workspace select                             # Set default workspace (writes to guild.json if in agent dir)
```

Environment variable overrides:

```bash
GUILD_WORKSPACE_ID=<id> guild agent test           # Override workspace for this command
```

## Testing

An agent must be tested using the `guild` tool: this uploads the agent to the
server runtime environment where the agent will operate.

```bash
# Interactive test session. With no version flag this builds an ephemeral
# version from the working directory — there is no --ephemeral flag.
guild agent test

# Bundle locally, then test (faster — skips server-side build)
npm run bundle
guild agent test --bundle agent.js.gz

# Test with structured JSON input (non-interactive)
npm run bundle
guild agent test --bundle agent.js.gz --mode json <<-EOF
{ "type": "text", "text": "this is my agent input" }
EOF
```

IMPORTANT! Most integrations require credentials. Choose a workspace (e.g. with
`guild workspace list`) that has appropriate credentials installed for each
integration your agent uses. If you cannot find one, tell the user: "I cannot
test the agent without access to a workspace that has access to all of the
integrations that this agent requires. I can't seem to find one. If I've
overlooked a workspace with the correct credentials, please let me know which
one to use. Otherwise, please configure a workspace appropriately and let me
know its name when it is ready."

## Chatting with agents

```bash
# Chat with any published agent by name
guild workspace chat --agent owner~agent-name

# Chat with a specific agent in a specific workspace
guild workspace chat --agent owner~agent-name --workspace owner~workspace-name

# One-shot mode (send prompt, get response, exit)
guild workspace chat --agent owner~agent-name --once "What can you do?"
```

To chat with the agent you are developing locally, use `guild agent chat` from
within the agent directory.

## Troubleshooting

### "No changes to save"

Working tree is clean and there are no unpushed commits. Make a code change,
commit it, then run `guild agent save` again.

### "guild.json not found"

You're not in an agent directory. Either `cd` into the agent directory, or run
`guild agent init` to create one.

### Validation failed

Check the error with `guild agent versions --limit 1`. Common issues:

- TypeScript compilation errors
- Missing dependencies
- Invalid schema

### guild.json accidentally tracked

If `guild.json` is tracked in git (it shouldn't be):

```bash
echo "guild.json" >> .gitignore
git rm --cached guild.json
git add .gitignore && git commit -m "Stop tracking guild.json"
# `guild agent save` always excludes guild.json from the uploaded version.
guild agent save --message "fix: stop tracking guild.json"
```
