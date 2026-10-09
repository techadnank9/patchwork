---
name: guild-factory-setup
description: >-
  Set up, resume, start work in, or inspect a Guild Factory with the Guild CLI. Use when the
  user asks to create or configure a software factory, continue an interrupted
  Factory setup, or check Factory status. Do not use for generic factory
  discussion or development of Guild's Factory source code.
---

# Guild Factory Setup

Use the installed `guild` CLI. It owns setup state, retries, authentication and
GitHub and Jira handoffs; do not reproduce those operations with raw API calls.

Factory setup changes Guild and connected tracker resources. Run it only when the user has
asked to set up or resume a Factory. For questions or planning, explain the
workflow without starting it.

## Check the CLI

Confirm the installed CLI before setup, and upgrade it if `guild factory` or a
flag named below is missing from its help (run `guild factory` with `--help`):

```bash
guild --version
```

## Start or resume setup

From the target repository, run:

```bash
guild factory init --mode jsonl --non-interactive --yes
```

When the repository cannot be inferred from its origin, or the user named a
different repository, pass it explicitly:

```bash
guild factory init acme/widgets --mode jsonl --non-interactive --yes
```

Keep the process attached and read each JSONL envelope as it arrives. Do not
replace JSONL with JSON: JSON reports only the last envelope after the command
ends, which can hide a human handoff while setup is still running.

Act on `next`:

- `poll`: keep reading the current process; do not start another setup.
- `wait_for_human`: immediately relay `human_action_required.hint`, `url`,
  `code`, `org` and `expires_in` when present, then keep reading. Never complete
  browser authentication or approve GitHub access for the user. A `sign_in`
  action supports both existing Guild accounts and account creation; the same
  browser flow returns the user to device approval. Other `kind` values are
  `install_github_app`, `add_repo_to_installation`, `regrant_github_app`,
  `fix_setup_script`, `connect_jira`, `request_access` and `org_approval`;
  for `request_access` and `org_approval` an administrator must act.
- `rerun`: an unchanged retryable command may be rerun once. Explain and ask
  before a fix that changes the repository, workspace, issue tracker, reuses an
  existing workspace, or skips environment verification. Do not loop the same
  failure.
- `stop`: report `message`, `details`, `fix` and `docs`; do not invent a
  workaround.
- `done`: verify the installed Factory with status.

Treat an unknown `schema_version` or `next` value as a stop condition and
report it rather than guessing.

## Jira setup

Keep the GitHub repository for code, and select Jira when the user requests it:

```bash
guild factory init acme/widgets --issues jira --jira-project-key ENG --mode jsonl --non-interactive --yes
```

Use the user's actual project key, never the example `ENG`. Existing connections
must belong to the Factory's account and either be account-wide or belong to its
workspace. `--yes` may accept one eligible connection but never chooses among
multiple connections or chooses a project. Ask the user to resolve the CLI's
`options`, then rerun with `--issues-credential-id <id>` or
`--jira-project-key <key>` as appropriate.

If a saved connection no longer works, report the error and the interactive
recovery command from `details`; the user can choose another connection or
`Connect another Jira site`. Do not keep retrying a revoked credential.

For a new Jira connection, supply `--jira-cloud-id <uuid>`. The user can read
`cloudId` at `https://<their-site>.atlassian.net/_edge/tenant_info` in their browser,
or ask their administrator. Use only the site the user supplied; do not invent a
site, fetch arbitrary URLs, or request an API token. Relay the CLI's `connect_jira`
browser handoff and wait for the exact callback-bound credential.

Setup saves the selected connection and validates its site and project before
commissioning. Once available, the optional `jira` receipt names `credential_id`,
`cloud_id`, `site_url`, `project_key`, `route_label` and `action_label`. Report the
site, project and both labels. A Jira issue needs the routing label first, then
the action label (or both in one saved update). The action label alone is not
enough. Do not add labels or start work without the user's instruction.

An older server may return `jira_setup_unavailable`; wait for its update rather
than bypassing validation. `init` does not reconfigure a live Factory's Jira
connection. Setup success is not proof of issue execution or a smoke job;
check that status reads `live` and state any untested provider behavior.

The environment step may create or update `.guild/setup.sh`. Do not commit it
automatically. Tell the user it needs review and should be committed if the
Factory will use it for later environment rebuilds.

## Verify or inspect status

Read the fleet as one bounded JSON result. It is an array of Factory records,
one per workspace, and may be empty:

```bash
guild factory status --mode json
```

After setup reaches `done`, pass the target repository to read only its
records:

```bash
guild factory status acme/widgets --mode json
```

Then use the record's immutable `factory_id` for the scoped activity read:

```bash
guild factory status --workspace 00000000-0000-4000-8000-000000000001 --mode json
```

To follow changes after setup, stream complete snapshots as JSONL:

```bash
guild factory status --workspace 00000000-0000-4000-8000-000000000001 --watch --mode jsonl
```

The first line is the current snapshot. Later lines appear only when routing or
activity changes; a new observation timestamp alone does not emit a line. Stop
the watch with Ctrl-C. Do not use `--mode json` with `--watch`.

Each record's `state` comes from its routes, checked in this order:

- `disconnected`: an active route has no credentials configured. Status checks
  only that a credential is attached, not that its grant still works, so a
  permission error from a later `start` or `test` means fixing the grant.
- `stopped`: no route is active.
- `live`: every route is active.
- `partial`: some routes are active, others are not.

No state means an issue has run. Report `activity` for that.

If no record matches, or more than one match is plausible, report the
ambiguity. Do not choose a Factory silently.

Report the vocabulary the status command provides: routing, sessions, tasks and
attention. Factory work may also report `dispatching`, `queued`, `running`,
`failed`, or `runtime_complete`. Runtime completion is not code correctness,
pull-request readiness, or business success. Mention activity truncation when
its flags are set.

## Start Factory work

When the user asks the configured Factory to work on a GitHub or Jira issue, validate
the exact request first:

```bash
guild factory start https://github.com/acme/widgets/issues/42 \
  --workspace 00000000-0000-4000-8000-000000000001 \
  --dry-run --mode json
```

Show the user the resolved Factory, issue and action. After confirmation, rerun
without `--dry-run`. Use the returned `next.command` to watch the same durable
work. A repeated start returns the current execution with `changed: false`.
After an uncertain provider response, an explicit retry can resume an unlinked
dispatch once readback confirms its action label is absent.

For Jira, pass the full HTTPS browse URL on the configured site and project,
such as `https://acme.atlassian.net/browse/ENG-42`, not a bare key. Use the user's
actual issue URL. The receipt preserves Jira identity and both configured labels.

Do not add or remove tracker labels yourself. Do not substitute `gh`, provider
API calls, a chat session, or an arbitrary trigger label. The Factory work API
owns authorization, configuration, idempotency and webhook correlation.

## Inspect optional smoke readiness

If the user asks whether a real test can run, inspect readiness without writes:

```bash
guild factory test plan --workspace 00000000-0000-4000-8000-000000000001 --mode json
```

Report `status` and each check's `status` and `message`. A blocked plan exits 0
because the diagnostic succeeded; it does not mean a test passed. A null tracker
means it was not proven. This only reads stored configuration, not live provider
or agent health. No issue, job, PR or saved plan is created.

## Run an optional test

Run a test only when the user asks for one. Setup's `--yes` is not test consent.
First save a preview; it creates no issue or job:

```bash
guild factory test preview --workspace 00000000-0000-4000-8000-000000000001 --mode json
```

Show the user the target, template, `expires_at` and the stated costs: the
test uses real agent credits with no hard spend cap, never merges, and
repository automations may run. Only after the user approves, run the exact
preview with its `run_id` and `approval_digest`:

```bash
guild factory test run <run-id> --approve <digest> --accept-credits --mode json
```

Rerunning the same command resumes rather than duplicating the test. To retry
the preview itself, pass `--request-key <uuid>` with the same key. Observe the
result without starting or cancelling work:

```bash
guild factory test status <run-id> --watch --mode jsonl
```

`--timeout <seconds>` bounds only the watch (1 to 3600, default 900). A timed-out
or interrupted watch does not cancel the test; resume it with the same command.
Do not use `--mode json` with `--watch`. Report the final `status`
(`passed`, `failed` or `blocked`), each check, and the issue and pull request.

Cleanup needs its own approval. Preview it first; it closes the test issue and
pull request and deletes nothing:

```bash
guild factory test cleanup <run-id> --mode json
```

After the user approves that cleanup plan, apply its digest:

```bash
guild factory test cleanup <run-id> --approve <cleanup-digest> --mode json
```

The run approval never approves cleanup. Do not substitute a manual issue,
label, chat or custom reviewer to bypass a gate.

## Stop Factory work

There is no Factory uninstall command. A Factory has several routes (issues,
pull requests, reviews, CI), and each is its own trigger, so deactivating one
can leave the others starting work. To stop new work, deactivate every route in
`routing.items` of the scoped status result whose `active` is true:

```bash
guild trigger deactivate <route-id>
```

Then re-run the scoped status and confirm its `state` reads `stopped`. To stop a
running session, interrupt it with the `session_id` from `activity.items`:

```bash
guild session interrupt <session-id>
```

Ask before running either.

## Boundaries

- Do not assume or edit `factory.yaml`; Factory setup does not depend on it.
- Do not delete triggers, workspaces, agents or credentials to imitate an
  uninstall command. Use the stop commands above and report other unsupported
  lifecycle requests.
- Prefer the CLI's `fix` and `docs` fields over hand-authored recovery steps.
