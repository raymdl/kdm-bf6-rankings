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
| Change pipeline or recovery state | Pipeline loader, v2 / v3 compatibility, Actions restore and persist, receipts, retry tooling | Completed work replayed, or resumable envelopes lost |
| Change public retention | Pointer validation, concurrent-release protection, public storage limits | Active bytes deleted |
| Change private retention | Numeric rebuild range, raw-only fields, backup and restore | Permanent loss of unique observations, especially 10 July – 11 August |
| Change schedules | Occurrence definitions and reconciler, Actions UTC slots, stale threshold, end-of-day timing, heartbeat period | Daylight-saving errors, or a stale dataset that looks healthy |
| Change AI prompts, models or metrics | Compiler schema, executor validation, writer caveats, usage accounting, offline evaluator, history format | The writer producing numbers, or hidden cost and failures |
| Deploy bot code | Deployed supervisor copy, launcher, dependency install, running revision on the host | Assuming a merge restarted the bot |
| Change website JS / CSS | `?v=` import version, affected routes and tests, Pages deploy | Browsers running stale cached modules against new code |
| Change traffic analytics | Site definitions, GraphQL selection, D1 migrations, Worker secrets, dashboard range contract | Credentials exposed, or traffic data mixed with member data |

## Compatibility contracts

| Contract | Current behavior |
|---|---|
| Pipeline state | Version 3; version 2 normalized on load |
| Legacy stage names | `archiveGit` writes numeric history to private R2; `siteGit` renders a local generation |
| Tracker state | One object with CAS updates and daily backups |
| Period rate qualification | 15 active minutes per calendar day of the resolved window |
| Git data snapshots | Frozen; current data is published through R2 |

## Observations

Point-in-time production checks are kept under `docs/archive/evidence/`. The latest is [22 September 2026](../archive/evidence/PRODUCTION_OBSERVATIONS_2026_09_22.md).
