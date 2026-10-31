# AI response path

[Atlas](README.md) · [Collection and Discord](COLLECTION_DISCORD.md) · [Artifact contract](REFRESH_PUBLICATION.md#artifact-contract)

## D12 · Two model calls around a deterministic executor

```mermaid
flowchart TB
  MSG["SRC · Eligible Discord question<br/>and bounded reply-chain context"]
  GATE["POLICY · Channel, command priority,<br/>cooldown, concurrency, monthly budget"]
  CAT["STORE · Local subject names<br/>and approved symbolic vocabulary"]
  COMP["RUN · Model call 1: compiler<br/>strict symbolic QueryPlan, no tools"]
  EXEC["RUN · Node validation and execution<br/>all authoritative BF6 calculations"]
  DATA["STORE · Pinned local generation<br/>and selected numeric-cache endpoints"]
  WRITE["RUN · Model call 2: writer<br/>explain validated ExecutionResult"]
  NUMS["POLICY · Picture prompt number check<br/>every number must match validated results"]
  IMG["RUN · Image model<br/>picture requests only"]
  OUT["OUT · Sanitized Discord response<br/>marked for eligible follow-ups"]
  MSG --> GATE
  GATE --> COMP
  CAT --> COMP
  COMP --> EXEC
  DATA --> EXEC
  EXEC --> WRITE
  WRITE --> OUT
  WRITE -.->|"picture request"| NUMS
  NUMS -.-> IMG
  IMG -.->|"picture attached to the reply"| OUT
```

A message is eligible if it tags the bot in a configured BF6 channel, or replies directly to an AI answer or to an overtake message (both carry an invisible marker). Replies to other bot messages, messages from bots and webhooks, and untagged conversation are ignored. BF6 commands take priority. Quoted messages and earlier reply-chain text are passed as bounded, untrusted context.

1. **Compiler.** Receives the question, the bounded context, member identities and names, and a catalogue of approved subjects, metrics, items, categories and operations. It does not receive the numeric dataset. It returns a symbolic `QueryPlan` and a flag saying whether the member asked for a picture. The host strips the flag before validation, so the plan format is unchanged. Pronouns such as "he" or "his" resolve to the player the conversation is about, never to the person asking.
2. **Executor.** Node validates the plan, loads only the local data it needs, resolves windows and subjects, performs every calculation, and builds an `ExecutionResult`. Full-cohort operations evaluate the whole eligible roster before slicing the output. Explicitly requested subjects are never dropped by truncation.
3. **Writer.** Receives the plan and the result, has no tools, and is instructed to explain the result without computing new numbers. Its reply text is not checked number by number. Partial coverage and unavailable rows must appear in the answer. When a reply is about a particular player, such as a roast or a picture, the host also gives the writer that player's most-used weapons, vehicles and gadgets and their time per class, read from the same local data with no extra model call. Tagged players reach the writer by name.
4. **Image (picture requests only).** When images are enabled and the monthly picture cap has room, a picture writer returns the reply text and an image prompt. The host checks every number in that prompt against the validated results before an image model draws it, and the picture is attached to the same reply. If the prompt is missing after one retry, a number fails the check, or drawing fails, the text reply posts alone. When pictures are off or the cap is spent, the writer says so in text.

Ordinary chat follows the same path with an empty result and no numeric reads. A compiler outage or incomplete compiler response stops after call 1 with a fixed "try again" reply. A plan that cannot be parsed or fails validation is not retried: the host answers from a local career profile of the player the message is about, or as chat when there is none, and the writer says the exact statistic could not be looked up. An incomplete writer response is not retried.

### Data sent to each stage

| Destination | Receives | Does not receive |
|---|---|---|
| Compiler | Question, bounded quoted context, symbolic catalogue, identities and names | Numeric history, raw GameTools payloads, credentials, tools |
| Executor | Validated plan and local data | Instructions from quoted context |
| Writer | Plan, computed results, required caveats, bounded context, and for player-focused replies that player's own equipment and class time | Tools or data access |
| Image model | One picture prompt whose numbers passed the host check | Plan, results, Discord IDs, credentials, tools |
| Discord | Sanitized final text with mentions suppressed, and the picture when one was drawn | Model-control objects, credentials, query datasets |

The models, reasoning effort, output-token limits, per-user cooldown, monthly message cap, image settings and monthly picture cap are set in configuration; see the [AI guide](../BF6_AI_REPLIES.md). The compiler, writer and image calls have separate accounting.

## D13 · Local-only statistics access

```mermaid
flowchart LR
  R2["STORE · Private numeric archive<br/>and active public release"]
  MAINT["RUN · Refresh / hydration / mirror<br/>outside the question path"]
  PTR["STORE · publication-state/<br/>current-state.json"]
  GEN["STORE · One immutable<br/>generation/data directory"]
  NUM["STORE · Local numeric cache<br/>dated observation files"]
  PLAN["RUN · Validated QueryPlan<br/>selects files and endpoints"]
  RESULT["OUT · Deterministic result<br/>provenance and coverage caveats"]
  R2 -.->|"maintenance / recovery only"| MAINT
  MAINT --> PTR
  MAINT --> NUM
  PTR -->|"pin for this execution"| GEN
  GEN --> PLAN
  NUM -->|"selected dates only"| PLAN
  PLAN --> RESULT
```

Answering a question reads only local files on the Mini PC: no GameTools, R2, delivery Worker or GitHub. If a required local file is missing, the executor fails instead of falling back to a remote source. R2 feeds the local files through refresh and hydration, outside the question path.

- Subject names come from local `latest.json`, cached per generation.
- Each execution pins the active generation's `data/` directory.
- Numeric history comes from the local numeric cache. `bf6-query-local-data.js` selects the dated endpoints the plan needs; some equipment metrics also scan the dates in between for coverage.
- Current equipment values come from `equipment-index.json`. Item and field combinations missing from it fall back to the local numeric cache, with the provenance labelled.
- If a field started being collected after the requested window began, the result is clamped to the covered range or reported as unavailable.

Pinning keeps one execution on one generation. The numeric cache, registry changes and model responses are not part of that pin. Roster changes invalidate AI caches separately ([D03](COLLECTION_DISCORD.md#d03--roster-visibility-and-removal)).

## D14 · Outcomes, accounting and failure handling

```mermaid
flowchart TB
  ACCEPT["RUN · Accept eligible attempt<br/>after budget check"]
  COMP["RUN · Compiler attempt"]
  EXEC["RUN · Host execution"]
  WRITE["RUN · Writer attempt"]
  IMG["RUN · Image attempt<br/>picture requests only"]
  HIST["STORE · ai-reply-history.jsonl<br/>v2 plan, results, outcome and usage"]
  USAGE["STORE · ai-reply-usage.json<br/>accepted messages and per-role tokens"]
  MISS["STORE · ai-unanswered-questions.jsonl<br/>host-determined missing answers"]
  OUT["OUT · Answer or controlled failure<br/>no unsanctioned data-source fallback"]
  ACCEPT --> USAGE
  ACCEPT --> COMP
  COMP -->|"valid plan"| EXEC
  COMP -->|"compiler_failed"| HIST
  EXEC -->|"successful / partial result"| WRITE
  EXEC -->|"executor_failed"| HIST
  EXEC -->|"requested rows unavailable"| MISS
  WRITE -->|"completed / writer_failed"| HIST
  COMP --> USAGE
  WRITE --> USAGE
  WRITE --> OUT
  WRITE -.->|"picture request"| IMG
  IMG --> USAGE
  IMG -->|"picture, or text alone on failure"| OUT
  USAGE -.->|"unreadable file pauses replies"| ACCEPT
  COMP -->|"static retry reply on failure"| OUT
  EXEC -->|"controlled failure"| OUT
```

| Local file | Contents |
|---|---|
| `data/ai-reply-history.jsonl` | Version 2 rows: validated plan and result, missing reasons, player equipment context, compiler and writer settings, timing, tokens, outcome, and for picture requests the image prompt and its result. Version 1 rows are from the retired single-call design |
| `data/ai-reply-usage.json` | Version 2 counters: accepted messages, compiler and writer requests, input and output tokens per role, and image calls and tokens. The monthly cap counts accepted messages, not tokens; the picture cap counts image calls. Version 1 files migrate with their spent budget |
| `data/ai-unanswered-questions.jsonl` | Questions the executor could not fully answer, with message and channel context. The executor decides completeness, not the writer |

`AI_REPLY_HISTORY_PATH`, `AI_REPLY_USAGE_PATH` and `AI_UNANSWERED_LOG_PATH` override the paths; production uses the defaults. These files are gitignored and have no offsite backup ([D28](ARCHIVES.md#d28--mini-pc-disk-loss)). A writer failure can still cost tokens. A usage file that exists but cannot be read is never treated as zero spend: AI replies pause and the owner is alerted until the file is repaired or removed and the bot restarted.

The bot's voice allows playful competitive replies but no administrative actions. User, role, `@everyone` and `@here` pings are suppressed. Questions about command syntax point to the pinned instructions.

## D15 · Offline evaluation

```mermaid
flowchart LR
  LOG["EVID · Selected historical rows<br/>and capability cases"]
  EVAL["RUN · bf6-ai-two-call-eval.js<br/>pin reconstructable evaluation dates"]
  COMP["RUN · Paid compiler call"]
  HOST["RUN · Current deterministic executor<br/>local-only data"]
  REPORT["OUT · Sanitized local/ai-evals/<br/>review artifacts"]
  LOG --> EVAL
  EVAL --> COMP
  COMP --> HOST
  HOST --> REPORT
```

`npm run eval:bf6-ai-two-call` replays selected history rows and capability cases through a paid compiler call and the current executor. It does not call the writer or post to Discord. Relative periods are evaluated as of the original question date when the inputs can be reconstructed; intraday cases without reconstructable inputs get semantic review only. Old reply text is provenance, not an expected answer.

## Source anchors

[AI service and sanitization](../../src/ai-replies.js), [compiler](../../src/bf6-query-compiler.js), [executor](../../src/bf6-query-executor.js), [local query reader](../../src/bf6-query-local-data.js), [local stats loader](../../src/bf6-ai-stats.js), [approved metrics](../../src/bf6-query-metrics.js), [window selection](../../src/bf6-query-windows.js), [evaluator](../../tools/bf6-ai-two-call-eval.js), [AI guide](../BF6_AI_REPLIES.md).
