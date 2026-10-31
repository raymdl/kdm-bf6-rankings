# Change register

[Atlas](README.md) · [Repositories](README.md#repositories)

## Change register

| Change | Check | Failure to prevent |
|---|---|---|
| Add or change a displayed stat | `BF6_STAT_CONFIG`, extraction, archive coverage, counters (if Period supported), browser definitions, AI metric catalogue and executor, overtake policy | A visible stat with missing historical operands or conflicting meaning |
| Change a counter's meaning or name | Producer counter paths and formula version, website `requires` / `derive`, AI rates and windows, parity fixtures | The same key silently producing different numbers |
| Change the effectiveness formula | Model version and fingerprints, full-cohort rebuild, labels, interpretation guide | Stale historical scores or two models in circulation |
| Widen the equipment projection | Archive writer, field start dates, catalogue / index / member artifacts, browser and AI endpoint rules | Unrecorded old counters read as zeros, or percentages differenced |
| Change identity or relink behavior | Resolver, nucleus comparison, registry schema, cache clearing, Actions link poll, audit and profile output | One account's history or cache attached to another |
| Change visibility or removal | Registry, roster filtering, cached republish, AI invalidation, boards and intents, per-member files, retained releases | Unlisting mistaken for erasure, or an unfiltered roster published |
| Change an artifact schema or path | Producer, manifest and roster validator, Worker URL resolution, lazy loaders, AI reader, hydration, recovery, parity | A mixed or unreadable release |
| Change refresh or receipt state | `refresh()`, notification receipts, publication-state pointer, schedule state | Completed work replayed, or Discord posts duplicated |
| Change public retention | Pointer validation, concurrent-release protection, public storage limits | Active bytes deleted |
| Change private retention or the numeric day format | Numeric rebuild range, raw-only fields, late-day sealing window, backup and restore, weekly cold-backup export and verify | Permanent loss of unique observations, especially 10 July – 11 August |
| Change schedules | Occurrence definitions and reconciler, Actions UTC slots, late-run day filing, stale threshold, end-of-day timing, heartbeat period | Daylight-saving errors, a late run filed under the wrong day, or a stale dataset that looks healthy |
| Change AI prompts, models or metrics | Compiler schema and its structured-output support on each model provider, executor validation, writer caveats, picture-prompt number check, usage accounting including image calls, offline evaluator, history format | The writer or a picture producing numbers, or hidden cost and failures |
| Deploy bot code | Deployed supervisor copy, launcher, dependency install, startup check and rollback marker, running revision on the host | Assuming a merge restarted the bot, or missing that it was rolled back |
| Change website JS / CSS | `?v=` import version, affected routes and tests, Pages deploy | Browsers running stale cached modules against new code |
| Change traffic analytics | Site definitions, GraphQL selection, D1 migrations, Worker secrets, dashboard range contract | Credentials exposed, or traffic data mixed with member data |

## Compatibility contracts

| Contract | Current behavior |
|---|---|
| Tracker state | One object with CAS updates and daily backups |
| Period rate qualification | 15 active minutes per calendar day of the resolved window |
| Site repository `data/` | Frozen; current data is published through R2 |
| Archive repository | Weekly one-way copy of the private numeric days; nothing reads it back |

## Observations

Point-in-time production checks are kept under `docs/archive/evidence/`. The latest is [22 September 2026](../archive/evidence/PRODUCTION_OBSERVATIONS_2026_09_22.md).
