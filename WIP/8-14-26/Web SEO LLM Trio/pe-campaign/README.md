# website-bot-five-push-v1 — PE campaign input

Operator intake that converts the five-push Website-Bot sequence into a
Program Execution campaign an agent can admit and build.

| File | Role |
|---|---|
| `AGENT_FEED.md` | Paste this to the executing agent. |
| `CAMPAIGN_SOURCE.yaml` | Immutable `l9.program-execution.campaign-source.v2` seed. |
| `INTENT.yaml` | Thin `program-execution.intent.v1` if the intent compiler is used. |
| `source-integrity-receipt.json` | sha256 bind of `CAMPAIGN_SOURCE.yaml`. |
| `../Program1.md` | Per-push todos, envelopes, evidence matrices. |
| `../L9 Website Improvement — Independent Validation Contract Pack.md` | Independent Gates 0–6. |

## Feed

In a new agent chat that can see `@environment/program-execution`:

1. Attach `AGENT_FEED.md` + `CAMPAIGN_SOURCE.yaml` + `Program1.md` + the
   Validation Contract Pack.
2. Tell the agent to execute `AGENT_FEED.md` as written.
3. Do not ask it whether to redesign the five pushes.

## Integrity

`CAMPAIGN_SOURCE.yaml` sha256
`d86592b07012068ac8c28a4140053507cffc3fd67c994e78a7612c6a7408b23a`

Runtime belongs under `$HOME/.l9/programs/website-bot-five-push-v1`.
This folder is intake only. It is not PE controller state.
