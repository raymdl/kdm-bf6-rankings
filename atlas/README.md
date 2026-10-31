# KDM BF6 Tracker · Data-flow atlas

[Rankings website](https://raymdl.github.io/kdm-bf6-rankings/) · [Change register](REGISTER.md)

KDM BF6 Tracker collects Battlefield 6 statistics for linked clan members, publishes rankings to a website, posts standings to Discord, and answers statistics questions through the KDM Tracker Discord bot. This atlas traces each input through the Windows Mini PC, Cloudflare R2, the website, the AI reply path, the archives, and the GitHub Actions fallback.

**Checked against `6d75707b` on 30 October 2026.**

Terms used throughout:

| Term | Meaning |
|---|---|
| Refresh | One collection of member statistics from GameTools, followed by publication |
| Release | An immutable set of generated JSON files that the website reads together |
| Generation | A local copy of one release on the Mini PC; the AI reads it |
| Tracker day | A calendar day that starts at midnight `America/Los_Angeles` |
| Listed / unlisted | Listed members appear in public output; unlisted members are still collected |
| CAS | Compare-and-set: a write that succeeds only if the stored object has not changed since it was read (ETag check) |
| Nucleus ID | The EA account ID behind one or more BF6 personas |
| CEI, RAIS, WRR | Composite Effectiveness Index, Risk-Adjusted Impact Score and Win Rate Residual: the Effectiveness Lab scores; see [effectiveness measures](https://github.com/raymdl/kdm-bf6-rankings/blob/94af6b1a2e9c87c917153d591da5b13ffbe184c0/EFFECTIVENESS_MEASURES.md) |

## Repositories

| Repository | Revision | Role |
|---|---|---|
| [kdm-discord-bot](https://github.com/raymdl/kdm-discord-bot/tree/6d757071bf4df239a69c18faa88d608de26539a8) (private) | `6d75707b` | Bot, collector, publisher, private-state adapters, delivery Worker, operator tools, host scripts, Actions |
| [kdm-bf6-rankings](https://github.com/raymdl/kdm-bf6-rankings/tree/686db1a4f9245ad25baff1f84bf71c872a379452) | `686db1a4` | Website shell, browser calculations, and the public copy of this atlas |
| [kdm-bf6-archive](https://github.com/raymdl/kdm-bf6-archive/tree/e6e87c5d4a70970ca1827c581e461a31b125886f) (private) | `e6e87c5d` | Weekly cold-backup mirror of the private numeric history, written one way by Actions; nothing reads it back |
| [bf6-analytics-dashboard](https://github.com/raymdl/bf6-analytics-dashboard/tree/ebf60634c22e23a88e7460813efaaaefdbab9895) (private) | `ebf60634` | Traffic Command: site-traffic Worker, D1 history and dashboard for the KDM Tracker and [BF6 Weapon Analyzer](https://raymdl.github.io/BF6-Weapon-Analyzer/) sites |

Source links into private repositories require access.

## D01 · Whole-system map

Arrows show data and control dependencies, not execution order.

```mermaid
flowchart TB
  SRC["SRC · GameTools, identity lookups,<br/>KovaaK API"]
  DIS["SRC / OUT · Discord application<br/>commands, events, boards, replies"]
  BOT["RUN · Mini PC<br/>Node bot and refresh pipeline"]
  STATE["STORE · Private R2<br/>tracker state and numeric history"]
  LOCAL["STORE · Mini PC<br/>publication generations and numeric cache"]
  RAW["STORE · Local raw gzip<br/>plus closed-day private R2 mirror"]
  PUB["OUT · Public R2<br/>immutable releases and current.json"]
  WEB["RUN / OUT · Website browser<br/>Pages shell + delivery Worker data"]
  AI["RUN · Local executor, two model calls<br/>and optional image model"]
  CI["RUN · GitHub Actions<br/>fallback, recovery, offline alerts"]
  COLD["STORE · kdm-bf6-archive<br/>weekly numeric cold backup"]
  HIST["EVID · Frozen site data snapshot,<br/>historical tools and review records"]
  TRAF["RUN / OUT · Traffic Command<br/>Cloudflare analytics + D1"]
  SRC --> BOT
  DIS -->|"events"| BOT
  BOT -->|"boards and confirmations"| DIS
  BOT -->|"conditional writes"| STATE
  STATE -->|"registry and archive reads"| BOT
  BOT --> LOCAL
  BOT --> RAW
  BOT --> PUB
  BOT -->|"eligible conversational message"| AI
  PUB -->|"delivery Worker"| WEB
  LOCAL -->|"read-only question inputs"| AI
  AI -->|"sanitized response and optional picture"| DIS
  CI -->|"shared authority"| STATE
  STATE -->|"weekly one-way export by Actions"| COLD
  CI --> PUB
  CI --> DIS
  HIST -.->|"reviewed recovery only"| BOT
  WEB -->|"site traffic, not player counters"| TRAF
```

Three stores hold authority for different things:

- **Private R2** holds the live registries and the retained numeric history.
- **Public R2** holds the files the website currently serves.
- **Local generation on the Mini PC** holds the files an AI question reads.

The archive repository is a copy, not an authority: a weekly Actions run exports the private numeric history into it, and no runtime path reads it back.

Website reloads and AI questions never start a GameTools collection.

## Chapters

| Chapter | Covers |
|---|---|
| [Collection and Discord](COLLECTION_DISCORD.md) | Identity linking, roster visibility, the Discord process, speedruns, KovaaK |
| [Refresh, calculations and publication](REFRESH_PUBLICATION.md) | Fresh versus cached data, pipeline stages, release publication, overtakes, calculations, artifact contract |
| [AI response path](AI.md) | Eligibility, the two model calls, picture replies, local data access, logging, offline evaluation |
| [Website and traffic analytics](WEBSITE.md) | Release pinning, route data, Period calculations, delivery Worker, Traffic Command |
| [Operations and recovery](OPERATIONS.md) | Deployment, scheduling, Actions fallback, monitoring, recovery |
| [Archives and durability](ARCHIVES.md) | Storage authority and retention, historical reconstruction, disk-loss exposure |
| [Change register](REGISTER.md) | What must change together, compatibility contracts |

## Legend

| Prefix / line | Meaning |
|---|---|
| `SRC` | External or user input |
| `RUN` | Process, calculation or control path |
| `STORE` | Retained state or cache |
| `OUT` | Visible output or published artifact |
| `POLICY` | Configuration, filtering or qualification rule |
| `EVID` | Historical source or review material; not a runtime input |
| Solid arrow | Data transfer or control dependency |
| Dashed arrow | Historical, supporting or gated relationship |

`easternDateKey` is a legacy name. Its current behavior is described where it appears.
