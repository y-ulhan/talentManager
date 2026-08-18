# Talent Match Terminal

Application-style internal platform for managing a talent roster and generating sourced AI-assisted client-match shortlists.

This is not a marketing website. It opens directly into the working product: Roster, New Match, History, Suggestions, Analytics, and Settings.

## What Is Included

- Visual roster screen with ranked search across roster fields and attached Wikidata enrichment.
- Manual add/edit/delete for talent records.
- Optional photo upload for talent cards.
- CSV, TSV, and basic `.xlsx` spreadsheet import with staged review.
- Structured misc-note timeline for imported catch-all fields and human-approved match insights.
- Field-level source and timestamp tracking for trust, review, and rollback.
- Suggestions inbox for tag ideas, import review items, stale availability nudges, and match-derived profile notes.
- Duplicate detection across manual adds, spreadsheet imports, attached Wikidata entities, and a background scan action.
- Availability exception rows for held/booked date ranges, with availability-aware matching.
- Similar-talent suggestions on talent profiles.
- Rate history per talent instead of silent rate overwrites.
- CSV roster export plus safe SQLite backup snapshots.
- New Match screen with a plain-language brief box and ranked results.
- Saved inquiry templates for recurring request patterns.
- Match results with structured requirements, "Here's what I understood", inline score signals, Shortlist, Close but not quite, and a required review gate.
- Client-facing copy-out formatter that strips internal fields and appends the required review disclaimer.
- History screen for reopening previous matches.
- Read-only Analytics screen for match and suggestion patterns.
- Single boss login for Phase 1, with owner/agent roles designed into the data model.
- Persistent local SQLite database.
- Claude Messages API calls from the backend process, so `ANTHROPIC_API_KEY` is never exposed in the browser.
- Optional gap-triggered Claude live web search for named roster talent only.
- Local sourced fallback matcher when no Anthropic key is configured.

## Environment

Copy `.env.example` to `.env` and set:

```bash
PORT=4173
DATABASE_URL=sqlite:./data/talent-terminal.db
SESSION_SECRET=replace-with-a-long-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-before-real-use
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-5
CLAUDE_WEB_SEARCH_TOOL=web_search_20250305
CLAUDE_WEB_SEARCH_MAX_USES=4
LIVE_SEARCH_TOP_N=5
LIVE_SEARCH_MAX_GAPS=10
LIVE_SEARCH_MAX_USES=2
LIVE_SEARCH_CACHE_DAYS=30
WIKIDATA_REST_BASE=https://www.wikidata.org/w/rest.php/wikibase/v1
WIKIDATA_LANGUAGE=en
WIKIDATA_USER_AGENT=TalentMatchTerminal/1.0 (you@example.com)
WIKIDATA_ACCESS_TOKEN=
```

If `ANTHROPIC_API_KEY` is blank, matching still works with a deterministic local fallback and every claim remains sourced to roster fields.

## Run

Requires Node 22.5 or newer.

```bash
npm run migrate
npm run seed
npm start
```

Open the local app URL printed by `npm start`, usually:

```text
http://localhost:4173
```

If `ADMIN_PASSWORD` is not set, the local demo login is:

```text
admin / terminal-demo
```

Set `ADMIN_PASSWORD` before real use. When set, the admin password is updated during migration/startup.

## Replace Roster With Wikidata Talent

To replace the active roster with 500 randomized public talent records from Wikidata:

```bash
npm run wikidata:roster
```

This uses the Wikidata Query Service for the bulk pull, then stores each person with their Wikidata QID and public-source metadata. It clears the active roster first, but leaves match history intact.

## Screens

### Roster

The boss sees the agency's talent list as cards with photo, name, tags, rate, and availability. They can search, filter by tag, add/edit/archive talent, upload a spreadsheet, attach a Wikidata public profile for rostered public figures, review a provenance-rich misc timeline, inspect rate history, add held/booked date ranges, see similar talent, or export a backup CSV.

Roster search is unified: it checks vetted roster fields first and attached Wikidata enrichment second. Results show match-reason chips such as `matched: tags` or `matched: Wikidata enrichment`, so the boss can distinguish agency-entered evidence from public enrichment before acting on a result.

Manual adds and edits run duplicate detection before saving. The app compares fuzzy names and Wikidata entity IDs, then asks the boss to confirm if a likely duplicate appears. Background duplicate scans create Suggestions inbox items that can be dismissed or merged; merging keeps a chosen primary record, appends safe secondary data and notes, reassigns references, and archives the secondary with an audit note.

Archived talent drop out of active roster search and matching by default, but stay in the database so old match history, rate history, and references do not point at missing records. Use Restore from the talent dialog to reactivate them.

The Wikidata attach picker filters candidates to humans (`P31 = Q5`), shows descriptions and occupations for disambiguation, and gently boosts candidates whose Wikidata occupations match the talent's existing roster tags. The admin still chooses the entity; the app never auto-attaches the top hit.

### New Match

The boss pastes the client request. The platform stores the raw brief plus a structured requirement object covering skills, tone, location, budget range, availability window, and category. It then interprets stated, inferred, and unclear criteria; matches against the roster; optionally checks public information for named roster talent only when a must-have requirement is not already covered; and returns sourced shortlist cards.

The local fallback uses keyword and regex extraction for requirements when no Anthropic key is configured. When Claude is configured, the prompt asks Claude to return the same requirement contract and the local parse is still provided as baseline context.

Shortlist cards include `Score signals`, showing the fields and terms that drove the score. The local fallback also uses recent approve/discard history as a lightweight heuristic to reweight fields and terms over time.

If a brief contains a parseable date window, matching checks held/booked rows. Held overlaps remain visible with a caution; booked overlaps are moved to `Close but not quite` with the booking reason instead of being hidden.

When `Check public info for roster talent when useful` is enabled and `ANTHROPIC_API_KEY` is configured, live search runs as a scoped gap branch after roster-only matching. It checks only top roster candidates, only uncovered must-have requirements, caches recent findings for 30 days, and stores results in `match_live_search`. Live findings appear as tier-3 evidence with source URLs, fetched date, and `supports` / `contradicts` / `inconclusive` confidence. They are never written to a talent profile automatically; approval creates a Suggestions inbox item that still goes through the sensitive-field policy.

Saved templates let the boss reuse recurring request patterns such as `bilingual TV host, LA`. `Copy client view` produces a sanitized shortlist draft that excludes internal feedback/discard context and appends the required review disclaimer.

Every result ends with:

```text
Review before sending to the client.
Requires review before external use.
```

### History

The boss can reopen past requests and see the full result, including the structured requirements that were stored with the original brief. Approvals/discards are saved as feedback for future matches.

### Suggestions

The boss gets one triage inbox instead of scattered maintenance prompts. Suggestions can come from spreadsheet conflicts, duplicate scans, auto-tag ideas from profile text, approved or discarded match feedback, stale availability, and stale Wikidata enrichment.

Suggestions are never applied automatically. Each item has a primary action such as `Add tags`, `Save note`, `Still accurate`, `Mark reviewed`, `Refresh`, `Apply refresh`, or `Merge records`, plus `Dismiss`. Wikidata refreshes are two-step: `Refresh` fetches proposed changes into a review item with a diff, and `Apply refresh` writes only after confirmation. Applying a suggestion updates the relevant roster field or misc-note timeline with source and timestamp metadata.

### Analytics

Analytics are read-only and computed from existing History, Suggestions, and requirement JSON. They show totals, most matched talent, most requested terms, weekly outcomes, and recent discard reasons. Demo data makes these numbers artificial until real usage accumulates.

### Settings

Phase 1 includes the boss login, copy-out-only client delivery, roster CSV export, safe database backup export, and a manual duplicate scan.

Database backups are SQLite snapshots created with `VACUUM INTO`, not raw file copies. The app creates one on startup when the last backup is older than 24 hours, then schedules daily backups while the process is running. Manual backup export downloads a `.sqlite` snapshot before risky changes. There is intentionally no in-app restore button in v1; restore is a manual file swap on disk so it cannot be triggered by a mistaken click.

## Spreadsheet Import

Upload accepts `.csv`, `.tsv`, and basic `.xlsx` files. Legacy binary `.xls` is not supported; save it as `.xlsx` or `.csv` first.

The importer is staged:

1. The platform parses the file and auto-detects column mappings.
2. The boss reviews the preview, for example `Day Rate` -> `rate` or `Profession` -> safe label extraction.
3. Rows are scored with confidence, fuzzy-matched against the current roster, and grouped as new, safe update, conflict, needs review, or error.
4. Unmapped safe columns are preserved as `misc_notes` entries with `source: csv_import`.
5. Commit only creates new records or safely fills blank fields/merges tags/misc notes on existing records. It does not blind-overwrite existing roster data.

Recommended source headers:

```csv
name,tags,rate,notes,availability,past_bookings,photo_path
```

`.xlsx` import reads the first worksheet. `tags` can be separated with semicolons or commas. Photo uploads from the Roster screen are stored locally under `uploads/`; spreadsheet imports can preserve an existing `photo_path` or Wikidata QID when those columns are mapped.

API routes:

- `POST /api/import-spreadsheet/stage` parses a multipart spreadsheet and returns the batch preview.
- `GET /api/import-batches/:id` reopens a staged or committed batch.
- `POST /api/import-batches/:id/commit` commits only safe rows using the confirmed mapping.
- `POST /api/import-spreadsheet` remains as a compatibility route; it stages first, then commits only safe rows.
- `GET /api/suggestions` lists open passive-data suggestions.
- `POST /api/suggestions/:id/resolve` applies or dismisses one suggestion.
- `GET /api/history/:id/client-export` returns the sanitized client copy-out text.
- `GET /api/inquiry-templates` lists saved request templates.
- `POST /api/inquiry-templates` creates or updates a request template by title.
- `DELETE /api/inquiry-templates/:id` deletes a saved request template.

## Celebrity Label Extraction

Spreadsheet imports do not need perfect headers. The parser looks for common celebrity/talent spreadsheet columns and turns them into roster labels:

- Direct label columns: `profession`, `occupation`, `category`, `genre`, `platform`, `audience`, `brand_fit`, `skills`, `language`, `style`, `market`, `location`.
- Social columns: `instagram`, `tiktok`, `youtube`, `twitter`, `followers`, `subscribers`, `handle`.
- Notes/bio columns: controlled keyword extraction for terms like `eyewear`, `spokesperson`, `fitness`, `beauty`, `fashion`, `luxury`, `family-friendly`, `comedy`, `sports`, `music`, `food`, `travel`, `gaming`, `tech`, `healthcare`, `podcast`, `voiceover`, and `bilingual`.
- Audience-size labels: follower/subscriber values such as `250K` or `1.2M` become tags like `100k+ audience` or `1m+ audience`.

The importer deliberately avoids protected or sensitive personal columns such as race, ethnicity, religion, politics, sexuality, health, disability, age, gender, marital status, address, phone, and email. The shared field policy forces those columns to `sensitive_ignore`, even if a spreadsheet header is remapped during preview.

The same policy is applied to profile free text. Manual notes, imported misc notes, accepted tag suggestions, and AI/match-derived notes are filtered before they can update the roster, so `misc_notes` cannot become a side door for protected-attribute data.

## Misc Notes

Talent profiles have a structured `misc_notes` timeline:

```json
[
  {
    "note": "favorite snack: Almonds before live shoots",
    "source": "csv_import",
    "field": "favorite_snack",
    "date": "2026-08-12T00:00:00.000Z"
  },
  {
    "note": "Strong live TV rationale from approved match",
    "source": "match_feedback",
    "match_id": 142,
    "added_by": "admin",
    "date": "2026-08-12T00:00:00.000Z"
  }
]
```

Spreadsheet catch-all columns fill this timeline automatically during safe commits. Match-derived notes are never automatic: approvals and discard reasons create Suggestions inbox items, and a human explicitly confirms profile edits with one click.

If a confirmed suggestion contains protected-attribute language, it is marked as policy-blocked and is not written to the profile.

## Field Provenance

Every talent carries `field_updated_at` and `field_source` metadata for roster fields such as tags, rate, notes, misc notes, availability, and past bookings. Sources include `boss_entered`, `csv_import`, `wikidata`, `suggestion`, `match_feedback`, and `review_confirmed`. The roster edit dialog shows these provenance chips so the boss can see where data came from and how fresh it is.

Rate changes are appended to `rate_history` with old rate, new rate, source, and timestamp, so negotiation context is preserved even when the current roster card only shows the latest rate.

## Terminal Mode

The visual platform is the default. A command-line version is still available for maintenance and testing:

```bash
npm run terminal
```

## Developer Walkthrough

For a file-by-file explanation of the architecture, key functions, and end-to-end control flow, see [TECHNICAL_WALKTHROUGH.md](./TECHNICAL_WALKTHROUGH.md).

## Match Accuracy Evaluation

This product is a ranked retrieval and recommendation workflow, so evaluate it with ranking metrics instead of plain classifier accuracy.

Run the included demo benchmark:

```bash
npm run eval:match
```

The script reads `data/match-eval-sample.json`, runs each labeled campaign brief through the non-persistent matcher, and prints JSON metrics:

- `precision_at_k`: fraction of top-k shortlist entries marked relevant.
- `recall_at_k`: fraction of all labeled relevant talent found in top-k.
- `hit_at_k`: whether at least one relevant talent appears in top-k.
- `mrr`: mean reciprocal rank of the first relevant talent.
- `ndcg_at_k`: ranking quality when labels use graded relevance.
- `citation_coverage`: fraction of returned claims with traceable sources.
- `unsupported_claim_rate`: claims without a database/public source.
- `review_flag_compliance`: whether the required reviewer warning is present.
- `avg_latency_ms`: average matcher runtime per brief.

The bundled benchmark is a starter set built from the current Wikidata demo roster tags. Use it to test the harness, not as a final product-quality claim. For resume-worthy accuracy numbers, replace it with a human-labeled file of 30-100 realistic agency briefs:

```json
[
  {
    "id": "eyewear_spokesperson_001",
    "brief": "Eyewear brand looking for a spokesperson, budget $5k.",
    "relevance": [
      { "talent_id": 12, "rating": 3 },
      { "talent_id": 48, "rating": 2 }
    ]
  }
]
```

Then run:

```bash
node --disable-warning=ExperimentalWarning scripts/evaluate-matching.mjs path/to/your-benchmark.json 5
```

Good resume metrics for this project are `Precision@5`, `Recall@10`, `MRR`, `NDCG@5`, `citation coverage`, and `review-flag compliance`.

## Implementation Notes

The default model is `claude-sonnet-5`. Main matching is roster-first; scoped live gap checks use Anthropic's server-side web search tool type `web_search_20250305` only for already-rostered candidates. The prompt prevents adding unlisted people, requires claim-level sources, labels inferences, returns structured requirements, and preserves the required human-review flag.

Wikidata uses the Wikibase REST API base URL `https://www.wikidata.org/w/rest.php/wikibase/v1`. Wikimedia requires a `User-Agent` header, so set `WIKIDATA_USER_AGENT` to include contact info. `WIKIDATA_ACCESS_TOKEN` is optional for this read-only integration, but the app will send `Authorization: Bearer ...` when it is configured from an OAuth 2.0 client.

Attached Wikidata entities are flattened into `wikidata_summary` at attach/import time and indexed alongside roster fields in SQLite FTS5. Search ranking weights roster-owned fields above Wikidata enrichment.

V1 is copy-out only. It does not email clients directly.
