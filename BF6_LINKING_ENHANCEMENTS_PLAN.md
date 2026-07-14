# BF6 Linking Enhancements Plan

Prepared: 2026-07-14
Status: implementation plan; no live link records should change until the audit and dry-run gates pass

## Objective

Improve `!bf6-link` so it safely handles cross-platform BF6 accounts, distinguishes the exact GameTools persona used for stats from the member's actual playing/Tracker platform, preserves complete identity metadata, and can audit or repair older links without corrupting a valid persona/platform tuple.

The central invariant is:

> `bf6PlayerId`, `bf6NucleusId`, `bf6Platform`, and `bf6PlatformId` describe one exact GameTools persona. A Tracker platform or user-preferred platform may differ and must be stored separately.

The live GameTools comparison established that `/bf6/multiple`, `/bf6/stats`, and `/bf6/profile` currently return the same player data when the platform changes but the exact persona and nucleus IDs remain fixed. That tolerance is not a reason to create inconsistent identity records. The batch request should continue using the platform belonging to its stored persona.

## Problems to solve

1. Name resolution prefers EA/PC when multiple exact-name personas exist, which can save a valid EA persona even when the member actually plays through Steam, Xbox, or PlayStation.
2. The current `bf6Platform` name can be mistaken for “the user's playing platform,” although it actually belongs to the selected GameTools persona.
3. Tracker may index a different persona under the same nucleus account. Replacing only `bf6Platform` with Tracker's platform would make the stored tuple internally inconsistent.
4. The one-time platform migration fills only missing metadata and rejects existing platform mismatches. It is not a full registry audit or alternate-persona discovery tool.
5. PlayStation personas can legitimately have `bf6PlatformId: null`, but the migration currently considers null incomplete.
6. Link confirmation parsing supports `platformid=...`, while confirmation generation omits it. Confirmation-derived recovery therefore loses part of the identity tuple.
7. Only 10 of the 38 current authoritative link-registry records persist a platform, even though the stats cache has an effective platform for all 38.
8. There is no user-visible distinction between the stats persona, preferred playing platform, and optional Tracker profile.
9. An exact username search can return several persona IDs under one nucleus account, several nucleus accounts using the same name, or both; those cases have different meanings and should not be flattened into one candidate list.
10. Some name-search candidates have no recorded BF6 stats and should not be presented as plausible choices when GameTools definitively confirms that they are empty.
11. When several playable candidates remain, the bot does not currently show live stat fingerprints or explicitly request the user's selection before saving a link.
12. The pinned Discord linking instructions do not describe the platform hint or the new multiple-account/persona confirmation flow.

## Non-goals

- Do not replace GameTools as the authoritative source for the persona used by KDM stat collection.
- Do not infer a user's preferred platform solely from Tracker and silently save it as confirmed.
- Do not switch existing personas merely because Tracker indexes another persona.
- Do not relax exact-name, exact-persona, nucleus, duplicate-link, or stats-payload verification.
- Do not combine this work with the historical Tracker stat import.

## Target data contract

### Existing GameTools identity fields

Keep the existing flat fields for compatibility with the refresh, site publisher, GitHub Actions, and historical messages:

```json
{
  "bf6PlayerId": "363127164",
  "bf6NucleusId": "2364300627",
  "bf6Platform": "ea",
  "bf6PlatformId": "cem_ea_id",
  "bf6ProfileName": "eMp_Terrae"
}
```

Document `bf6Platform` everywhere as the **GameTools identity platform**, not necessarily the member's launch platform. A future schema rename may alias it to `bf6IdentityPlatform`, but this project should not require a flag-day rename.

### New optional member-level fields

Add separate fields for user preference and Tracker:

```json
{
  "bf6PreferredPlatform": "xboxone",
  "bf6PreferredPlatformSource": "user-selected",
  "bf6PreferredPlatformVerifiedAt": "2026-07-14T00:00:00.000Z",

  "bf6TrackerProfileId": "3112342777",
  "bf6TrackerProfileName": "Terrae",
  "bf6TrackerPlatform": "xboxone",
  "bf6TrackerUrl": "https://tracker.gg/bf6/profile/3112342777/overview",
  "bf6TrackerMappingSource": "fingerprint-verified",
  "bf6TrackerVerifiedAt": "2026-07-14T00:00:00.000Z"
}
```

Normalize platform values internally to `ea`, `steam`, `psn`, or `xboxone`. Normalize Tracker labels such as `origin` to `ea` and `xbl`/`xbox` to `xboxone` only in the Tracker/preference fields; never use that normalization to rewrite a stored persona ID's platform.

### Optional verified alternate personas

If alternate-persona support is implemented, store only identities that have been verified through GameTools:

```json
{
  "bf6AlternatePersonas": [
    {
      "playerId": "290377828",
      "nucleusId": "2364300627",
      "platform": "xboxone",
      "platformId": "xbox",
      "profileName": "Terrae",
      "source": "gametools-exact-persona",
      "verifiedAt": "2026-07-14T00:00:00.000Z"
    }
  ]
}
```

An alternate must share the stored nucleus ID unless a human explicitly approves an account correction. Do not create an alternate record from a Tracker URL alone.

## Identity invariants

Enforce these invariants in one reusable validator:

1. `bf6PlayerId`, `bf6NucleusId`, and `bf6Platform` are required together for a save-ready GameTools identity.
2. `bf6PlatformId` is required for EA, Steam, and Xbox when GameTools exposes it.
3. A null PlayStation platform ID is valid and complete when the exact persona and nucleus are verified.
4. Changing `bf6Platform` requires re-resolving the stored `bf6PlayerId`; it cannot be independently edited.
5. A returned stats/profile payload must match the expected persona and nucleus IDs.
6. The same persona+nucleus pair cannot belong to two Discord members.
7. A Tracker profile ID cannot belong to two Discord members.
8. A preferred platform is advisory and never changes the batch identity tuple.
9. Candidates sharing one nucleus ID are platform personas belonging to one EA account and must be grouped together.
10. Candidates with different nucleus IDs are separate EA accounts even when their names are identical and must be shown as separate account groups.
11. A candidate may be removed only after a successful GameTools response definitively shows no recorded BF6 play. A timeout, rate limit, gateway error, or missing batch entry is `unknown`, not empty.
12. Candidate stats are user-facing fingerprints only. They must never automatically establish account ownership or override an explicit platform/persona choice.

## Enhanced `!bf6-link` command

### Supported inputs

Retain current inputs and add an optional platform hint:

```text
!bf6-link <name>
!bf6-link <personaId>
!bf6-link <name-or-personaId> -platform ea|steam|psn|xbox
```

Use `-platform` as the documented syntax. The parser may also accept `--platform` as a convenience alias. Accept friendly values (`xbox`, `playstation`, `origin`) and normalize them. Keep the platform flag outside the parsed name so multi-word names and an optional trailing `@user` continue to work.

The platform hint selects a persona candidate; it does not overwrite a candidate's platform. If the candidate returned by exact persona lookup conflicts with the hint, reject the request with a clear explanation.

### Resolution behavior

#### Numeric persona ID

1. Query GameTools by persona ID.
2. Require an exact persona ID match.
3. Use the platform and nucleus returned for that exact persona.
4. If a platform hint was supplied, require it to match.
5. Run the current identity/duplicate checks and save.

This remains the safest way to resolve a known platform-specific persona.

#### Name without a platform hint

1. Collect every complete exact display-name or username match from GameTools and Choriper's all-platform global search rather than sorting EA/PC first and immediately choosing one.
2. Do not make Choriper's BF6-specific `/bf6/player` endpoint the preferred or blocking discovery step. It may be retained only as optional enrichment/fallback; the known PSN members are found by the global search, and the BF6-specific endpoint can expose only the EA persona of a cross-platform account.
3. Deduplicate candidates by persona+nucleus+platform.
4. Group the remaining personas by nucleus ID:
   - one nucleus with several persona IDs means one cross-platform EA account
   - several nucleus IDs mean several distinct EA accounts matching the name
5. Verify candidate identities using the existing exact GameTools rules.
6. Check every verified candidate for recorded BF6 play before asking the user to choose.
7. If exactly one playable candidate remains and every discarded candidate was definitively empty, save the playable candidate normally.
8. If several playable or unknown candidates remain, return `confirmation_required` with a reason such as `multiple_personas`, `multiple_nuclei`, or `stats_inconclusive`.
9. Never silently pick EA solely because it sorts first, and never choose a candidate based on the closest-looking stats.

#### Name with a platform hint

1. Filter exact-name candidates to the requested normalized platform.
2. Run identity and recorded-play verification for every matching candidate.
3. If exactly one playable candidate remains, link it.
4. If none remain, distinguish confirmed-empty profiles from temporarily unavailable verification and report the platforms that were found.
5. If multiple same-platform personas or nucleus accounts remain, request explicit persona selection rather than guessing.

### Recorded-BF6-play filtering

Use one bounded `/bf6/multiple` request containing all candidate tuples whenever possible. Normalize each returned row and reuse the existing recorded-play rule: positive `timePlayedHours` or positive player kills means the candidate has recorded BF6 play.

Classify every candidate independently:

- `playable`: a valid response has positive playtime or player kills; keep it
- `empty`: a successful authoritative response has `hasResults=false` or a valid all-zero BF6 profile; suppress it from the normal choice list
- `unknown`: timeout, 429, 5xx, malformed response, or missing batch entry; do not discard it

If the batch fails globally, fall back only for unresolved candidates using the exact persona+nucleus+platform stats route. Rank availability must not decide whether a candidate is playable.

Outcomes:

- one `playable`, all others `empty`: link the playable candidate
- several `playable`: request user confirmation with live fingerprints
- `playable` plus `unknown`: request confirmation and label unavailable fingerprints
- all `empty`: report that no exact-name account has recorded BF6 stats yet
- only `unknown`: return `unreachable` and retry later

### Candidate fingerprints and user confirmation

For every candidate that survives filtering, show:

- account group (`Account A`, `Account B`, and so on), derived from nucleus ID without exposing the nucleus ID
- platform and exact profile/display name
- persona ID
- Player Rank when available
- Player K/D (`infantryKillDeath`)
- player kills
- time played when available

Fetch K/D, kills, and playtime in the candidate batch. Rank requires the separate profile endpoint and must use a short, bounded, best-effort lookup. A rank timeout must not delay or suppress the confirmation prompt; display `Rank unavailable` or omit the field.

When several personas share one nucleus, state that they belong to the same EA account and cross-progression may make their stats identical. In that case, platform and persona ID—not the stat fingerprint—are the deciding information.

Nothing is saved while `confirmation_required` is outstanding. The required cross-path confirmation mechanism is a generated explicit command for each choice, because it works with both the always-on bot and the delayed GitHub Actions poll:

```text
Reply with one of these exact commands:
1. !b6-link 363127164 -platform ea
2. !b6-link 290377828 -platform xbox
```

When linking another member, preserve the target mention in each generated command. Discord buttons may be added as a convenience, but the explicit command must remain available. Any button/token implementation must expire, be restricted to the initiating user or authorized moderator, and reverify the chosen tuple before saving.

### Multiple-persona response example

```text
I found two playable BF6 personas for Terrae under the same EA account:

1. EA - eMp_Terrae
   Rank 342 · Player K/D 5.08 · 52,408 kills
   Persona 363127164

2. Xbox - Terrae
   Rank 342 · Player K/D 5.08 · 52,408 kills
   Persona 290377828

These personas share one EA account, so their cross-progression stats may be identical.
Nothing was linked. Reply with one of these exact commands:
`!b6-link 363127164 -platform ea`
`!b6-link 290377828 -platform xbox`
```

### Multiple-nucleus response example

```text
I found two different BF6 accounts matching ExamplePlayer:

Account A - Steam
Rank 286 · Player K/D 3.42 · 24,810 kills · 312 hours
Persona 1001234567890

Account B - EA
Rank 41 · Player K/D 1.18 · 2,104 kills · 27 hours
Persona 3456789012

Nothing was linked. Reply with the command for your account:
`!b6-link 1001234567890 -platform steam`
`!b6-link 3456789012 -platform ea`
```

Do not include nucleus IDs or other internal identifiers in the public response unless they are already considered safe for the current link-confirmation channel.

### Preferred platform capture

When a member supplies `-platform` and the selected persona matches it, save that value as both the persona platform and `bf6PreferredPlatform` with `user-selected` provenance.

When a numeric persona is used without a hint, save only the persona platform. Do not assume it is the preferred platform.

Optionally add a separate command for changing preference without relinking:

```text
!bf6-platform ea|steam|psn|xbox
```

That command changes only `bf6PreferredPlatform`. It must state explicitly that the stats persona is unchanged.

## Tracker profile linking

Tracker linkage should be separate from `!bf6-link`, for example:

```text
!bf6-tracker-link <tracker-profile-url-or-id>
!bf6-tracker-unlink
```

The flow should:

1. Require an existing verified GameTools link.
2. Parse only the supported BF6 Tracker URL/ID form.
3. Fetch the Tracker profile without triggering Tracker's visible refresh action.
4. Compare display aliases and available current-stat fingerprints with the KDM/GameTools record.
5. Prefer evidence that the Tracker persona shares the same nucleus; if Tracker does not expose nucleus, use documented fingerprint confidence instead.
6. Show the proposed Tracker name/platform/profile ID and require an explicit confirmation when confidence is not exact.
7. Enforce Tracker profile ID uniqueness.
8. Store Tracker fields separately and never rewrite the GameTools persona tuple.

Because Tracker's BF6 endpoints are internal, undocumented, and throttled, failure to fetch Tracker must not block or invalidate the primary GameTools link.

For the initial rollout, importing the already-reviewed 38-profile manifest may be safer than exposing a public command. The command can follow once request stability and rate limits are better understood.

## Confirmation and recovery metadata

Update link confirmations to distinguish the concepts:

```text
Linked KDM member to BF6 stats identity:
EA - eMp_Terrae - persona 363127164
Preferred playing platform: Xbox
Tracker profile: Terrae (Xbox)
```

The machine-readable metadata line must round-trip the complete GameTools tuple. Extend the existing format backward-compatibly:

```text
-# BF6 IDs: discord=... ea=... playerid=... nucleusid=... platform=psn platformid=- profile=...
```

Use `platformid=-` as an explicit valid-null sentinel for PlayStation and normalize it back to null. Continue accepting old messages with no platform or platform ID.

If preferred/Tracker fields are included in Discord recovery metadata, add optional tokens after the existing fields and update the parser defensively. Do not make recovery of the primary GameTools tuple depend on Tracker metadata.

## Registry audit and migration

### Phase 1: Read-only identity audit

Add a dedicated script, separate from the mutating migration, that inspects all linked members rather than only incomplete ones. Suggested command:

```text
npm run actions:bf6-audit-identities -- --output docs/bf6-identity-audit.json
```

For each member:

1. Query the exact stored persona ID.
2. Compare returned persona ID, nucleus ID, platform, platform ID, and profile name.
3. Compare link-registry values with cached stats-member identity values.
4. Compare optional Tracker/preferred platform fields separately.
5. Produce one outcome:
   - `exact`
   - `missing_registry_metadata`
   - `cache_only_metadata`
   - `platform_id_valid_null`
   - `identity_mismatch`
   - `platform_mismatch`
   - `unreachable`
   - `manual_review`
6. Never mutate state.

The report should include proposed changes only for metadata that belongs to the exact stored persona.

### Phase 2: Correct the existing migration

Update `src/bf6-platform-migration.js` so:

- completeness uses platform-aware rules and accepts verified PSN null platform IDs
- exact stored persona resolution remains mandatory
- it can fill missing nucleus/platform/platform-ID/profile-name metadata
- it never replaces an existing persona or independently changes a platform
- it reports existing conflicting data for manual review
- dry-run is the default for the one-time cohort correction
- rerunning is idempotent

### Phase 3: Backfill authoritative registry metadata

After reviewing the full audit:

1. Back up and hash `state/tracker-state.json` and the GitHub-backed registry source.
2. Apply only exact-persona metadata completions.
3. Expect up to 28 current link records to gain persisted platform metadata; confirm the exact audit count before writing.
4. Preserve the existing EA persona platform for the eight known Tracker-platform mismatches unless an explicit persona relink is approved.
5. Re-run the audit and require every mutation to move to `exact` or `platform_id_valid_null`.
6. Confirm local and scheduled GitHub Actions paths serialize the same fields.

### Phase 4: Import Tracker mappings separately

Import the reviewed Tracker manifest into the new Tracker fields in a separate change. Do not combine this with the GameTools platform metadata migration, so each diff has one clear meaning and rollback path.

## Stats request behavior

Keep the current batch contract:

```json
{
  "player_id": 363127164,
  "user_id": 2364300627,
  "platform": "ea"
}
```

The platform must come from the same stored GameTools persona as `player_id`, not from `bf6PreferredPlatform` or `bf6TrackerPlatform`.

Add defensive validation immediately before batch serialization. Reject or divert a member to re-resolution if the identity tuple is incomplete; do not silently borrow Tracker/preferred platform data.

When a batch response supplies identity fields, verify both persona and nucleus where available. Continue matching batch results by exact persona ID and retain the existing per-member fallback behavior.

## User-visible status and administration

Add a status view for members and moderators, either as a command or within existing link output:

```text
BF6 stats identity: EA / persona 363127164
Preferred platform: Xbox (user selected)
Tracker: Terrae / Xbox / profile 3112342777
Last identity verification: 2026-07-14
```

Moderators should also have a dry-run audit summary showing:

- total links
- complete GameTools tuples
- missing authoritative registry metadata
- preferred/Tracker mismatches, labeled as expected alternates rather than errors
- true persona/platform inconsistencies
- unreachable profiles

Avoid publishing internal confidence details or raw API payloads in general Discord channels.

## Update the pinned instructions and post one announcement

Keep the existing `src/bf6-setup-discord.js` create/update/pin control flow. Update only its canonical `INSTRUCTIONS` content, then run the existing `npm run setup:bf6-discord` command so it patches the current bot-authored pinned instruction message in place. Do not replace, unpin, or delete the existing instruction message.

The updated pinned message should retain the existing recognizable header, stay below Discord's message-length limit, and include at least:

```text
**BF6 / GameTools Bot Setup**

Link your BF6 account:
`!b6-link YourBF6Name`
`!b6-link 347891802`

Optional platform hint:
`!b6-link YourBF6Name -platform ea`
`!b6-link YourBF6Name -platform steam`
`!b6-link YourBF6Name -platform psn`
`!b6-link YourBF6Name -platform xbox`

`!bf6-link` also works. Add `@user` at the end when linking someone else.

If an exact name matches multiple BF6 accounts or platform personas, the bot
will remove profiles with no recorded BF6 play, show live Rank, Player K/D,
kills, and playtime for the remaining choices, and ask you to confirm one.
Nothing is linked until you send the exact selection command shown by the bot.

Unlink: `!b6-unlink`
Manual refresh: `!bf6-refresh`
```

Final wording may retain the existing Choriper help URL and tracked-stat description, but it must explain that `-platform` is optional and that the bot may request confirmation. Validate the final rendered length and formatting in a test before posting.

### Pinned-message update requirements

1. Record the existing pinned instruction message ID before the rollout.
2. Run `npm run setup:bf6-discord` after the new linking behavior is deployed.
3. Verify the command patched the same message ID and that it remains pinned.
4. Do not call the delete-message or unpin routes.
5. Repeated BAU runs must continue patching that same pinned message rather than creating additional instruction posts.
6. The existing initial/disaster-recovery behavior may create and pin a message only when no recognized bot-authored instruction message exists.

### One-time unpinned announcement

After the pinned message has been updated and verified, have the bot post one brief, unpinned announcement in `DISCORD_BF6_LINK_CHANNEL_ID`:

```text
**BF6 linking commands updated**

You can now optionally include your platform when linking:
`!b6-link YourBF6Name -platform ea|steam|psn|xbox`

If your name matches multiple BF6 accounts or platform personas, the bot will
ignore profiles with no recorded BF6 play, show live stat fingerprints for the
remaining choices, and ask you to confirm the correct persona.

The pinned linking instructions have been updated with the full details.
```

The announcement must disable mentions and must not be pinned. Implement it as a separate explicit one-time action, not as part of bot startup or normal `setup:bf6-discord` BAU behavior. Suggested command:

```text
npm run actions:bf6-announce-linking-update -- --dry-run
npm run actions:bf6-announce-linking-update -- --post
```

Use a stable announcement marker such as `**BF6 linking commands updated**`. Before posting, inspect recent messages in the configured link channel for the same bot-authored marker and skip if it already exists. Default to dry-run unless `--post` is supplied. Log the posted or existing message ID. If the pinned instruction update was not verified, do not post the announcement.

## Implementation phases

### Phase A: Semantics and lossless metadata

1. Add the shared identity validator and platform normalizer.
2. Fix PSN-null completeness.
3. Emit and parse `platformid`, including the null sentinel.
4. Update documentation and confirmation wording to say “stats identity platform.”
5. Add backward-compatibility tests for old confirmation messages.

### Phase B: Ambiguity-aware resolver

1. Change candidate selection to return all exact candidates.
2. Group exact candidates by nucleus and persona IDs.
3. Add `-platform` hint parsing and accept `--platform` as an optional alias.
4. Filter only definitively empty BF6 profiles using a bounded candidate batch and exact per-candidate fallback.
5. Add live K/D, kills, playtime, and best-effort rank fingerprints.
6. Introduce `confirmation_required` with explicit `multiple_personas`, `multiple_nuclei`, and `stats_inconclusive` reasons.
7. Update immediate and delayed link handlers so confirmation produces a terminal instructional response rather than an endless retry.
8. Make the all-platform candidate search authoritative for discovery; retain the BF6-specific Choriper endpoint only as optional enrichment/fallback.
9. Reverify the exact persona+nucleus+platform tuple supplied by the user's generated selection command before saving.

### Phase C: Audit and registry completion

1. Implement the read-only full audit.
2. Run it against all 38 links.
3. Review the proposed mutation set.
4. Correct the migration and perform a dry run.
5. Persist exact-persona metadata only after approval.

### Phase D: Preferred platform and Tracker linkage

1. Add optional preferred-platform fields and status output.
2. Import the reviewed Tracker mapping manifest separately.
3. Add Tracker commands only if internal endpoint stability and throttling are acceptable.
4. Consider alternate-persona storage after the flat-field release is stable.

### Phase E: Discord instructions and one-time announcement

1. Update only the canonical instruction text with `-platform` examples and the multiple-candidate confirmation behavior; preserve the setup script's existing edit-in-place flow.
2. Test that setup patches the existing pinned instruction message ID and never posts or deletes when that message exists.
3. Add the separate dry-run-by-default one-time announcement action with duplicate-marker detection.
4. After the new link behavior is deployed, run `npm run setup:bf6-discord` and verify the existing pin was edited in place.
5. Preview the announcement, then post it once and verify it is unpinned.
6. Run the announcement action again in dry-run/post mode and confirm it detects the existing marker and skips rather than posting a duplicate.

## Required tests

### Parser and command tests

- multi-word names still parse with and without `-platform`
- `--platform` is accepted as an optional alias when retained
- the platform option parses correctly before an optional trailing `@user`
- friendly platform aliases normalize correctly
- an invalid platform flag is rejected without linking
- numeric persona plus matching hint succeeds
- numeric persona plus conflicting hint fails safely
- old `!bf6-link` syntax remains valid

### Resolver tests

- one exact candidate links normally
- several persona IDs under one nucleus are grouped as one cross-platform account
- the same exact name under several nucleus IDs is grouped as distinct accounts
- exact same name on EA and Xbox returns `confirmation_required`, not an automatic EA selection
- a platform hint selects the matching exact candidate
- two same-platform exact candidates request persona confirmation
- confirmed all-zero/no-results candidates are removed before confirmation
- a timeout, 429, 5xx, malformed response, or missing batch row leaves the candidate `unknown` rather than discarding it
- one playable candidate plus only definitively empty candidates links normally
- several playable candidates produce fingerprints and exact selection commands
- all confirmed-empty candidates produce the no-recorded-BF6-stats response
- rank failure does not block candidate confirmation
- stat similarity never automatically selects a candidate
- no candidate is selected merely because it is EA/PC
- exact numeric persona behavior remains unchanged
- Choriper candidates still require GameTools verification
- persona/nucleus mismatches remain rejected
- a temporary upstream outage remains `unreachable`

Use Terrae as the multiple-persona regression fixture: an EA persona and Xbox persona share one nucleus, may return identical cross-progression stats, and selecting one must never rewrite the other's platform. Add a separate fixture with the same exact username under two nucleus IDs to verify Account A/B grouping and stat-fingerprint confirmation.

### Confirmation-response tests

- the response shows account group, platform, profile name, persona ID, Player K/D, kills, playtime, and best-effort rank
- nucleus IDs are used for grouping but are not exposed publicly
- same-nucleus candidates include the cross-progression/identical-stats warning
- every displayed candidate has an exact generated `!b6-link <personaId> -platform <platform>` command
- a target `@user` is preserved when linking on someone else's behalf
- nothing is persisted before the explicit selection command is reprocessed and reverified
- optional buttons are restricted to the initiating user or authorized moderator and cannot bypass tuple reverification

### Metadata and migration tests

- EA, Steam, Xbox, and PSN identity metadata round-trip through confirmation parsing
- PSN null platform ID is complete and round-trips through `platformid=-`
- old messages without platform fields remain valid
- migration fills only missing exact-persona metadata
- migration is idempotent
- existing platform conflicts are reported but not auto-corrected
- cache-only platform metadata can be proposed for registry persistence only after exact persona verification

### Tracker/preference tests

- preferred platform may differ from GameTools identity platform
- Tracker platform may differ without altering batch serialization
- Tracker profile IDs are unique
- Tracker fetch failure does not affect the GameTools link
- unverified Tracker data cannot create an alternate GameTools persona

### Batch and fallback tests

- `/bf6/multiple` always uses the GameTools identity platform
- preferred/Tracker fields never enter the batch body
- incomplete tuples are re-resolved or safely excluded from the preferred batch
- existing exact-ID response matching and individual fallback behavior remain intact
- candidate filtering batches all candidate tuples when possible and falls back only for unresolved rows
- a global candidate batch failure cannot convert every candidate into confirmed empty

### Discord instruction and announcement tests

- the updated pinned instruction content includes optional `-platform` examples and multiple-candidate confirmation behavior
- the final pinned message stays within Discord's message-length limit
- existing setup behavior patches the recognized pinned message ID in place
- BAU setup does not create, delete, or unpin when the recognized instruction message exists
- the one-time announcement is posted with mentions disabled and is not pinned
- announcement dry-run performs no mutation
- a pre-existing bot-authored announcement marker prevents a duplicate post
- unrelated bot/user messages containing similar words do not trigger the duplicate check

## Validation and rollout

1. Run focused link, resolver, migration, cache, audit, batch, and site-data tests.
2. Run the full test suite.
3. Run the identity audit against a copied state file.
4. Exercise dry-run migration against that copy and compare the before/after tuples.
5. Test immediate local linking and delayed GitHub Actions linking with the same fixtures.
6. Deploy Phase A before changing candidate selection.
7. Deploy Phase B and observe ambiguity/error rates before any registry migration.
8. Run the reviewed Phase C one-time registry completion.
9. Add Phase D data only after the primary identity registry is clean.
10. Update and verify the existing pinned instruction message in place.
11. Preview and post the one-time unpinned linking-update announcement, then verify a rerun skips it.
12. Monitor link failures, confirmation responses, batch missing-member rates, and fallback usage for at least several refresh cycles.

Do not merge a migration that depends on Tracker availability. GameTools linking and stat refresh must remain fully functional when Tracker is unavailable or throttled.

## Acceptance criteria

The enhancement is complete when:

- no name-based link silently chooses among multiple platform personas
- confirmed no-play candidates are removed without treating unavailable requests as empty
- multiple persona IDs are grouped by nucleus and multiple nucleus IDs are presented as separate account groups
- every remaining ambiguous choice receives live stat fingerprints when available and an exact user-confirmation command
- no ambiguous identity is saved before explicit user confirmation and exact tuple reverification
- every saved GameTools platform belongs to its stored persona ID
- PSN null platform IDs are treated as valid where appropriate
- confirmation metadata losslessly recovers the GameTools identity tuple
- all 38 links have an audited outcome
- exact-persona metadata is persisted in the authoritative link registry
- preferred and Tracker platforms are stored and displayed separately
- batch requests never use Tracker/preferred platform fields
- immediate and scheduled link flows behave consistently
- the existing pinned instruction message is updated in place and remains the sole pinned linking guide
- exactly one unpinned linking-update announcement is posted, with duplicate prevention for reruns
- all focused and full-suite tests pass
- rollback artifacts and the pre-migration state hash are retained

## Rollback

1. Restore the pre-migration registry/state snapshot.
2. Revert the optional preferred/Tracker fields independently from the GameTools tuple.
3. Retain the ambiguity-aware resolver if it is functioning safely; it does not require migrated data.
4. If command parsing causes issues, disable the new flags while retaining numeric and legacy name linking.
5. Re-run the read-only audit and a normal stats refresh to confirm the original identity tuples and cached data remain usable.

## Primary files expected to change during implementation

- `src/bf6.js`
- `src/bf6-links.js`
- `src/index.js`
- `src/bf6-actions-check-links.js`
- `src/bf6-setup-discord.js` (instruction content only; retain edit-in-place behavior)
- a new one-time BF6 linking-update announcement action
- `src/bf6-platform-migration.js`
- a new read-only identity-audit module/action
- `test/bf6-resolve.test.js`
- `test/bf6-links.test.js`
- `test/bf6-platform-migration.test.js`
- `test/bf6-multiple.test.js`
- Discord setup/announcement tests
- audit/cache tests as needed
- `package.json`
- `README.md`
- `BF6_PROFILE_MATCHING_WATERFALL.md`
