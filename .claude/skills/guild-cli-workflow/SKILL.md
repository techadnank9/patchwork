---
name: guild-cli-workflow
description: Agent development using the Guild CLI. Activated when user mentions guild agent commands, saving/publishing agents, clone/pull workflow, or agent testing. Covers CLI commands and common workflows.
---

# Guild CLI Agent Development Workflow

For local agent development using the Guild CLI. Save and pull sync agent files through the Guild API.

## MCP vs CLI

If Guild MCP tools are available (check for tools prefixed with `guild_`), use them for **read operations**: searching agents, listing workspaces, reading contexts, checking sessions, viewing credentials. MCP tools are faster and don't require shell execution.

Use the **CLI** (via Bash) for **local development operations**: `guild agent init`, `guild agent save`, `guild agent test`, `guild agent pull`, `guild agent clone`. These work with local files, which MCP can't do.

## CRITICAL: Always Use the Guild CLI

**Use the CLI to create agent scaffolding and save versions to Guild.** Use your
own git workflow to manage local history.

```bash
# Create a new agent
guild agent init --name my-agent --template LLM --category development

# Clone an existing agent (full name or short name)
guild agent clone guildai~dev-assistant
guild agent clone dev-assistant  # resolves to your-username~dev-assistant
cd dev-assistant

# Save changes (uploads the agent directory to Guild and creates a version)
guild agent save --message "Description of changes"

# Save and publish
guild agent save --message "Description" --wait --publish
```

## What the CLI Handles

- Proper `.gitignore` (includes `guild.json`)
- Correct file structure
- Git remote configuration to Guild server
- Version management and validation
- Publishing workflow

## Keep Guild Metadata Managed by the CLI

- ❌ Manually create `package.json`, `tsconfig.json`, or `guild.json`
- ❌ Manually edit an agent's version history on the server (use `guild agent save`)
- ❌ Edit `guild.json` (it's generated and gitignored)

`guild agent pull` downloads the latest saved version without requiring git.
It preserves local edits when the remote file is unchanged and refuses conflicts
before changing files. Back up or reconcile the named files, or use
`guild agent pull --force` to accept the remote changes at those paths. Other local
edits and untracked files are preserved. Git history stays under your control.

## Common Commands

### Project Setup

```bash
# Install Guild CLI skills for a coding assistant. Prompts you to choose
# Claude Code, Codex, or Gemini, previews the changes, and asks to confirm.
guild setup

# Choose the assistant non-interactively
guild setup --provider claude
guild setup --provider codex     # same as --codex
guild setup --provider gemini

# Also create an instruction template in the project root
guild setup --claude-md
guild setup --codex --agents-md
guild setup --provider gemini --gemini-md

# Skip the confirmation prompt
guild setup --provider claude --yes
```

### Creating Agents

```bash
# Create and initialize a new agent (interactive — prompts for name and template)
guild agent init
guild agent init --name my-agent --template LLM --category development
guild agent init --name my-agent --template AUTO_MANAGED_STATE --category development
guild agent init --name my-agent --template BLANK --category development

# Fork an existing agent
guild agent init --fork owner~agent-name

# Clone to work on an existing agent (full name, short name, or UUID)
guild agent clone owner~agent-name
guild agent clone agent-name  # auto-resolves owner
```

### Working with Existing Agents

```bash
# Clone to work on an agent
guild agent clone guildai~dev-assistant
cd dev-assistant

# Pull remote changes (from collaborators or web edits)
# Includes saved web editor drafts; excludes temporary test/chat versions
guild agent pull

# Check current version status
guild agent versions --limit 1

# Show version history (git-log-style)
guild agent log

# Show what changed between local files and the latest published version
guild agent diff

# Compare local files against a specific version
guild agent diff 1.0.4

# Get latest code
guild agent code

# Search across all agent code files
guild agent grep "pattern"
guild agent grep "pattern" --published
```

### Saving Changes

`guild agent save` uploads the agent directory's files to Guild and creates a version — no git commit or push is needed. Files matching `.gitignore`, plus `.git`, `.guild`, `node_modules`, `dist`, and `.env*`, are excluded. Change detection and a conflict check use a local `.guild/state.json` file.

On the first save after upgrading, the CLI compares your files with the latest
committed version before bumping `package.json`. Matching files restore the local
state and the save continues without `--force`. If they differ, the CLI names the
version and paths for you to review. An interactive save asks before overwriting;
a non-interactive or `--json` save requires an explicit `--force` for that case.
New `init`, `clone`, and `fork` checkouts record their starting version, so you can edit
and save immediately.

Already have the source in your own repository? Name an existing Guild agent and
the source directory. No clone, Git remote, or `guild.json` is required:

```bash
guild agent save myorg~my-agent --path ./agents/my-agent --message "Release" --publish
```

The explicit target overrides `guild.json` without changing it. Without a target,
the CLI reads `guild.json` from the selected directory. File filtering, version
bumps, and `.guild/state.json` all apply to that directory. A fresh folder whose
files differ from Guild still requires confirmation or `--force`; this is a full
source snapshot, including deletion of remote files missing locally.

For a first release, opt in to creating a missing target privately:

```bash
guild agent save myorg~my-agent --path ./agents/my-agent \
  --create-if-missing --agent-type GOOSE --publish --message "First release"
```

No separate init or clone is needed. The CLI waits for initialization, uploads
your files, validates them, and publishes the first version as `1.0.0` unless
your source or `--version-number` specifies another version. TypeScript source
versions are preserved on the first release unless you explicitly request a bump.
Use `--agent-type GUILD_TYPESCRIPT` for TypeScript source. Existing targets must
match the type and keep their visibility and normal overwrite protections.

Creation and publication are separate operations. A failure can leave an
unpublished private agent; inspect it and retry rather than creating another one.
Nothing is installed into a workspace automatically.

```bash
# Save the current directory as a draft version
guild agent save --message "WIP: still testing"

# Save and wait for validation
guild agent save --message "Fix bug" --wait

# Save, validate, and publish
guild agent save --message "Release v1.0" --wait --publish

# Overwrite even if someone saved a newer version since your last save
guild agent save --message "Fix bug" --force
```

### Publishing

```bash
# Publish latest validated version
guild agent publish

# Check publication status
guild agent versions --limit 1
```

### Running in CI

Set `GUILD_API_KEY` to an account API key (`<id>:<secret>`) with the `agents:write`
scope, and every command authenticates with it: no `guild auth login`, nothing
stored. It takes precedence over a stored login, and git operations on Guild
repositories use it too. `guild agent test` also needs `sessions:write` and
`workspaces:read`.

```bash
export GUILD_API_KEY="$GUILD_KEY_FROM_CI_SECRETS"
# Existing target; source and version are managed in this repository.
# --force explicitly permits replacing Guild's current source from a fresh checkout.
guild agent save myorg~my-agent --path ./agents/my-agent \
  --no-bump --force --message "Release" --publish
```

For interactive use, `guild auth login` continues to use OAuth. The same save
command works with either login or an API key. Publication does not make an agent
public. Either set up the target beforehand or add `--create-if-missing` and
`--agent-type` to the release command. Keeping these flags for subsequent releases
does not bypass the fresh-checkout comparison or `--force` requirement above.

To test a bundle without cloning first, name the agent instead of relying on
`guild.json`:

```bash
guild agent test --bundle dist/agent.js.gz --agent myorg~my-agent \
  --workspace myorg~ci --mode json < input.json
```

### Testing

```bash
# Interactive test session
guild agent test

# Test uncommitted changes without saving — this is what `guild agent test`
# already does; there is no --ephemeral flag

# Test with specific input
guild agent chat "Hello, can you help me?"
```

### Chatting with Agents

```bash
# Chat with The Smith
guild chat

# Chat with any published agent by name
guild workspace chat --agent owner~agent-name

# Chat with a specific agent in a specific workspace
guild workspace chat --agent owner~agent-name --workspace owner~workspace-name

# One-shot mode (send prompt, get response, exit)
guild workspace chat --agent owner~agent-name --once "What can you do?"
```

To chat with the agent you are developing locally, use `guild agent chat` from within the agent directory.

## File Structure

After `guild agent init`, you get:

```
my-agent/
├── .git/              # Git repo (remote is Guild server)
├── .gitignore         # Includes guild.json
├── agent.ts           # Your agent code (default; can also be in src/)
├── package.json       # Dependencies
├── tsconfig.json      # TypeScript config
└── guild.json         # Agent ID (gitignored, local only)
```

## Version Lifecycle

1. **Draft** - After `guild agent save` (no `--publish`)
2. **Validating** - After `--publish`, running validation
3. **Published** - Validation passed, available for use
4. **Failed** - Validation failed, check errors

## Troubleshooting

### "No changes to save"

The agent directory is unchanged since your last save. Make a code change, then run `guild agent save` again.

### "No agent ID provided and not in an agent directory"

Neither an explicit target nor local config identified the agent. Either:

- Pass `guild agent save myorg~my-agent --path ./agents/my-agent`
- `cd` into an agent directory with `guild.json`
- Run `guild agent init` to create one

### Validation Failed

Check the error with `guild agent versions --limit 1`. Common issues:

- TypeScript compilation errors
- Missing dependencies
- Invalid schema
