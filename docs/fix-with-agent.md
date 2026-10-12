# Fix with agent

An admin on **Drift → By project** can hand a drifting pin to an agent. Two records are made: a **GitHub issue** (the work
order the agent runs from, because the agent and its PR live in GitHub) and a **platform support ticket** in the care hub
(`konnect-ops`, the record the operators already work). The registry stays the authority: the agent opens a *draft* PR, a
person merges it, and the declared pin is updated afterwards.

## What one click does

1. **Check the repo.** Read the project's `package.json` (the project's *Path in repo*) and find the package's exact pin.
   If the repo is already at or past the latest version, the click is **refused** (the registry is the stale side: update
   the declared pin instead). If the repo has a different, older version than the registry, the upgrade starts from the
   repo's version and says so. If the repo cannot be read (no path recorded, token lacks *Contents: read*, file missing),
   it proceeds and says it could not check.
2. **Reuse an open ticket.** An open issue with the same title is linked instead of duplicated.
3. **Open the GitHub issue** (mentions `@claude`; draft PR only; "done when" checklist).
4. **Open the support ticket** through `POST /api/platform/support/intake` (priority: major = high, minor = medium,
   patch = low), then comment on the issue with a hidden marker holding the ticket id.
5. **Record the hand-off** (`agent_runs`) so Drift shows *Agent working: PLT-0007* on that row until the pin moves.

Steps 4 and 5 are best effort. If the care hub is down or not configured, the GitHub issue is still created and the
console says the issue is the only record.

## After the click

| Event | What happens to the ticket |
| --- | --- |
| Agent opens a draft PR | `agent-ticket-sync` workflow (in the repo) moves it to *in progress* and adds an internal note with the PR link |
| PR merged | Internal note: waiting for the declared pin to be updated |
| Admin sets the declared pin to the target version (or later) in the console | The console resolves the ticket and stamps `agent_runs.ticket_resolved_at` so it is never resolved twice |

A pin set short of the target leaves the ticket open. Pins changed by direct SQL do not resolve tickets.

## Configuration

| Where | Setting | Purpose |
| --- | --- | --- |
| Console (Vercel) | `AGENT_GITHUB_TOKEN` | Issues read/write + Contents read on the registry's repos |
| Console (Vercel) | `CARE_HUB_INTAKE_URL`, `CARE_HUB_INTAKE_TOKEN` | Optional: care hub tickets |
| `konnect-ops` (Vercel) | `SUPPORT_INTAKE_TOKEN`, `SUPPORT_INTAKE_ACTOR_USER_ID` | Intake secret, and the platform operator user tickets are created as |
| Repo secrets (`konnect-caas-base`) | `ANTHROPIC_API_KEY`, `NODE_AUTH_TOKEN` | Claude workflow |
| Repo secrets (`konnect-caas-base`) | `CARE_HUB_INTAKE_URL`, `CARE_HUB_INTAKE_TOKEN` | Status sync workflow |

Database: migrations `004` (project path, `agent_runs`) and `005` (ticket columns; column-level `UPDATE` on
`ticket_resolved_at` only).
