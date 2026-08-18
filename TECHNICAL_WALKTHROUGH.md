# Talent Match Terminal Technical Walkthrough

This document explains how the program operates and what the key functions in each file do. The main README is the user/setup guide; this file is the developer-facing map of the codebase.

## System Overview

Talent Match Terminal is a local, application-style platform for a talent agency workflow:

1. The server starts from `platform.mjs`.
2. `platform.mjs` imports `lib/talent-core.mjs`, runs migrations, creates/updates the admin user, schedules backups, serves static frontend files, and exposes JSON API routes.
3. The browser loads `public/index.html`, `public/styles.css`, and `public/app.js`.
4. `public/app.js` checks `/api/session`, logs the admin in, hydrates roster/history/suggestions/templates/analytics, and renders the app screens.
5. Roster operations, spreadsheet imports, Wikidata lookups, matching, backups, and feedback are all sent to backend API routes.
6. `lib/talent-core.mjs` owns almost all domain logic: SQLite schema, FTS5 search, roster CRUD, import staging, safety policy, matching, live search, history, suggestions, backups, and Wikidata.
7. `terminal.mjs` is an alternate command-line interface that calls the same core functions.

The important boundary is:

```text
Browser UI
  -> public/app.js API client
  -> platform.mjs HTTP routes/session/static serving
  -> lib/talent-core.mjs domain logic + SQLite + Anthropic/Wikidata calls
  -> data/talent-terminal.db, uploads/, backups/
```

## Runtime Data

- `data/talent-terminal.db`: SQLite database.
- `uploads/`: local talent photo storage.
- `backups/`: safe SQLite snapshot backups.
- `.env`: optional runtime configuration.

## package.json

`package.json` declares an ESM Node application requiring Node `>=22.5.0`.

Scripts:

- `npm start`: runs `platform.mjs`, the browser platform.
- `npm run platform`: same as `npm start`.
- `npm run terminal`: runs the CLI interface in `terminal.mjs`.
- `npm run migrate`: runs migrations through `scripts/run-core.mjs`.
- `npm run seed`: inserts a small hand-written seed roster.
- `npm run wikidata:roster`: imports 500 public figures from Wikidata using `scripts/import-wikidata-roster.mjs`.

## platform.mjs

`platform.mjs` is the HTTP server. It uses Node's built-in `http` module instead of Express. Its jobs are authentication/session cookies, routing, file uploads, static asset serving, and scheduled backups.

### Key Constants

- `PUBLIC_DIR`: path to `public/`, where HTML/CSS/JS assets live.
- `PORT`: local port, default `4173`.
- `SESSION_SECRET`: HMAC secret for signed session cookies.
- `SESSION_COOKIE`: cookie name, `tt_platform_session`.
- `SESSION_TTL_SECONDS`: session lifetime.
- `DAILY_BACKUP_MS`: interval for scheduled safe backups.
- `MIME_TYPES`: content types for static file serving.

### Session And Auth Functions

- `timingSafeEqual(left, right)`: compares HMAC signatures without leaking timing differences.
- `createSessionCookie(user)`: builds a signed, HttpOnly session cookie from user id, username, role, and expiry.
- `clearSessionCookie()`: expires the session cookie during logout.
- `parseCookies(request)`: parses the browser's `Cookie` header into a `Map`.
- `getSessionUser(request)`: verifies the signed cookie and returns `{ id, username, role }` when valid.
- `requireUser(request, response)`: enforces login for protected API routes and sends `401` when unauthenticated.

### Request Body Functions

- `readBody(request, limitBytes)`: reads a request as UTF-8 text with a maximum size.
- `readBodyBuffer(request, limitBytes)`: reads a request as a `Buffer`, used for file uploads.
- `readJson(request)`: parses JSON request bodies.
- `readSpreadsheetUpload(request)`: accepts either JSON spreadsheet content or multipart file upload data.
- `parseMultipartFormData(buffer, boundary)`: extracts uploaded file fields from a multipart body.

### Response Functions

- `sendJson(response, status, data, headers)`: serializes JSON with the correct headers.
- `notFound(response)`: sends a `404` JSON response.

### API Router

- `handleApi(request, response, url)`: central API router. It checks the route and method, calls `talent-core` functions, and writes JSON or file-download responses.

Important route groups:

- Auth: `GET /api/session`, `POST /api/login`, `POST /api/logout`.
- Roster: `GET/POST /api/talents`, `GET/PATCH/DELETE /api/talents/:id`, `POST /api/talents/:id/restore`.
- Availability: `POST /api/talents/:id/availability`, `DELETE /api/talents/:id/availability/:availabilityId`.
- Misc notes: `POST /api/talents/:id/misc-notes`.
- Similar talent: `GET /api/talents/:id/similar`.
- Wikidata: `GET /api/wikidata/search`, `POST /api/talents/:id/wikidata`.
- Import: `POST /api/import-spreadsheet`, `POST /api/import-spreadsheet/stage`, `GET /api/import-batches/:id`, `POST /api/import-batches/:id/commit`.
- Export/backup: `GET /api/export`, `GET /api/backups`, `POST /api/backups`.
- Duplicates: `POST /api/duplicates/scan`, `POST /api/duplicates/merge`.
- Analytics: `GET /api/analytics`.
- Matching/history: `POST /api/match`, `GET /api/history`, `GET /api/history/:id/client-export`, `GET /api/history/:id/live-search`, `PATCH /api/history/:id/feedback`.
- Templates: `GET/POST /api/inquiry-templates`, `DELETE /api/inquiry-templates/:id`.
- Suggestions: `GET /api/suggestions`, `POST /api/suggestions/:id/resolve`.
- Seed: `POST /api/seed`.

### Static Server Functions

- `serveFile(response, absolutePath, cacheControl)`: reads and sends static files with MIME headers.
- `serveStatic(request, response, url)`: maps browser URLs to files in `public/` or uploaded media in `uploads/`.

### Startup And Backup Functions

- `startPlatform()`: runs migrations, creates the HTTP server, routes API/static requests, and starts listening on `PORT`.
- `scheduleBackups()`: creates a startup backup when needed and schedules daily backups.
- `runScheduledBackup(reason)`: calls the core backup function and catches/logs failures.

## lib/talent-core.mjs

`lib/talent-core.mjs` is the main application engine. It owns the data model, matching rules, import safety, search, suggestions, and external API integrations.

### Top-Level Configuration

- `APP_ROOT`: app root path.
- `ADMIN_USERNAME`, `DEFAULT_ADMIN_PASSWORD`: Phase 1 admin login defaults.
- `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_WEB_SEARCH_TOOL`, `CLAUDE_WEB_SEARCH_MAX_USES`: Claude configuration.
- `LIVE_SEARCH_TOP_N`, `LIVE_SEARCH_MAX_GAPS`, `LIVE_SEARCH_MAX_USES`, `LIVE_SEARCH_CACHE_DAYS`: scoped live-search behavior.
- `DATABASE_PATH`, `UPLOADS_DIR`, `BACKUP_DIR`: local storage paths.
- `WIKIDATA_REST_BASE`, `WIKIDATA_ACCESS_TOKEN`, `WIKIDATA_LANGUAGE`, `WIKIDATA_USER_AGENT`: Wikidata configuration.
- `TALENT_FIELDS`: canonical roster fields with provenance.
- `PUBLIC_ROSTER_FIELDS`: fields that matching can cite.
- `IMPORTABLE_FIELDS`: fields spreadsheet imports can write.
- `IMPORT_REVIEW_THRESHOLD`: confidence threshold for safe import commit.
- `MATCH_SYSTEM_PROMPT`: Claude system prompt and JSON contract for sourced matching.

### Environment And Migration

- `loadEnvFile()`: loads `.env` manually before config constants are used.
- `resolveDatabasePath(databaseUrl)`: supports `sqlite:...` database URLs.
- `migrate()`: creates all tables, columns, indexes, FTS5 search table, admin user, actor references, and startup backfills.
- `ensureColumn(table, column, definition)`: additive migration helper.
- `backfillWikidataSummaries()`: fills `wikidata_summary` from existing public source JSON.
- `ensureTalentSearchIndex()`: creates/recreates the FTS5 index when schema changes.
- `rebuildTalentSearchIndex()`: backfills FTS rows from active talents.
- `updateTalentSearchIndex(talent)`: syncs one talent into FTS5.
- `removeTalentSearchIndex(talentId)`: removes one FTS row.
- `ensureAdminUser()`: creates or updates the Phase 1 admin account.
- `adminUserId()`: returns the admin user's numeric id.
- `actorUserId(actor)`: maps a user/actor object to a database user id.
- `actorLabel(actor)`: display label for audit fields.
- `backfillActorReferences()`: assigns existing legacy rows to the admin user.
- `ensureWikidataUniqueIndex()`: enforces unique active Wikidata QIDs.

### Auth And Core Utilities

- `seed()`: inserts demo roster records.
- `authenticate(username, password)`: validates a login.
- `hashPassword(password, providedSalt)`: creates salted SHA-256 password hashes.
- `timingSafeEqual(left, right)`: safe hash compare.
- `verifyPassword(password, user)`: checks a password against stored salt/hash.
- `now()`: ISO timestamp helper.
- `asJson(value, fallback)`: safe JSON parse helper.
- `normalizeTags(value)`: accepts arrays or delimited strings and returns clean tags.

### Talent Normalization And Provenance

- `normalizeTalentInput(input)`: converts user/import payloads into canonical talent fields.
- `normalizePublicSources(value)`: parses public source arrays/JSON.
- `normalizeMiscNotes(value)`: converts misc notes into structured timeline entries.
- `normalizeMiscNoteEntry(item)`: validates one misc-note entry.
- `makeMiscNote(...)`: builds a normalized misc note.
- `mergeMiscNotes(...groups)`: combines note timelines while deduplicating.
- `stableNoteId(note, date)`: creates stable note ids.
- `talentFromRow(row)`: converts SQLite talent rows into frontend/API objects.
- `normalizeFieldSource(value, fallback)`: ensures every field has source metadata.

### Rate And Availability

- `getRateHistory(talentId, limit)`: returns recent rate changes.
- `recordRateHistory(talentId, oldRate, newRate, source, changedBy)`: appends rate change history.
- `availabilityFromRow(row)`: maps availability rows into objects.
- `listTalentAvailability(talentId, options)`: lists held/booked windows.
- `normalizeAvailabilityInput(input)`: validates start/end/status/note.
- `normalizeDateInput(value)`: strict `YYYY-MM-DD` parser.
- `addTalentAvailability(identifier, input, actor)`: creates a held/booked exception.
- `deleteTalentAvailability(identifier, availabilityId)`: deletes an availability exception.
- `availabilityOverlaps(talent, requirement)`: checks requested date window against booked/held rows.
- `normalizeRequirementDateWindow(requirement)`: converts parsed requirements to a comparable date window.
- `softDateInput(value)`: forgiving date parser for brief text.

### Roster Reads, Search, Similarity

- `getTalent(identifier, options)`: finds a talent by id or name.
- `listTalents(query, options)`: lists/searches active or archived talent, using FTS5 where possible.
- `similarTalents(identifier, limit)`: finds nearby profiles based on tags and text.
- `toFtsQuery(query)`: escapes user search input into an FTS5 query.
- `searchScoreTalent(talent, query)`: secondary per-field match scorer/provenance labeler.
- `searchFieldLabel(field)`: human display label for search match chips.

### Duplicate Detection And Merge

- `findPotentialDuplicates(input, options)`: checks one proposed talent against existing records.
- `scanDuplicateTalents(options)`: scans the whole roster and creates suggestions.
- `duplicateTalentScore(left, right)`: combines name/entity similarity into a duplicate score.
- `createPossibleDuplicateSuggestion(leftId, rightId, score)`: stores a duplicate review item.
- `mergeDuplicateTalents(primaryId, secondaryId, actor)`: merges two records, preserves history, archives secondary.
- `mergeConflictNotes(primary, secondary, addedBy, date)`: writes merge context into misc notes.
- `mergeLongText(primaryText, secondaryText, heading)`: safely combines text fields.
- `mergePublicSources(...groups)`: deduplicates source records.
- `rewriteMatchHistoryTalentReferences(secondary, primary, actor)`: keeps past history linked after merge.
- `matchHistoryReferencesTalent(row, talentId)`: checks history references.
- `rewriteResultTalentReferences(result, secondary, primary)`: updates match result talent ids/names.
- `rewriteRosterSnapshotReferences(snapshot, secondary, primary)`: updates stored roster snapshots.
- `talentEntityIds(talent)`: returns entity ids used for dedupe.

### Roster Writes

- `createTalent(input, source, actor)`: creates a talent, detects duplicates, writes provenance, syncs FTS.
- `patchTalent(identifier, input, source, actor)`: updates fields, records provenance/rate history, syncs FTS.
- `addTalentMiscNote(identifier, input, addedBy)`: appends a policy-filtered misc note.
- `upsertTalent(input, source, actor)`: creates or updates by name.
- `archiveTalent(identifier, actor)`: soft-deletes a talent from active matching/search.
- `restoreTalent(identifier, actor)`: reactivates an archived talent.
- `deleteTalent(identifier)`: hard delete path used mainly by CLI/import replacement scripts.
- `saveTalentPhotoDataUrl(identifier, dataUrl, actor)`: stores uploaded image data under `uploads/`.
- `clearTalentPhoto(identifier, actor)`: removes the current profile image.
- `parsePhotoDataUrl(dataUrl)`: validates image MIME/base64 payloads.
- `removeStoredPhoto(photoPath)`: deletes an old uploaded photo.

### Match History And Client Export

- `sourceSnapshotForTalent(talent)`: creates the cited roster snapshot passed to matching.
- `matchHistoryFromRow(row)`: maps stored history JSON into objects.
- `recentMatchHistory(limit)`: returns recent match history for prompting/local learning.
- `getMatchHistoryEntry(identifier)`: fetches one history record.
- `listLiveSearchFindings(matchHistoryId)`: returns saved live search evidence.
- `formatClientShortlistExport(identifier)`: creates copy-out text with internal fields stripped.
- `clientSourceLine(claim)`: formats one claim source for client copy.
- `singleLine(value)`: squashes text for output.
- `storeMatchHistory(...)`: inserts brief, requirements, result, snapshot, model metadata.
- `updateStoredMatchResult(...)`: updates a history row after live search or normalization.
- `updateHistoryFeedback(identifier, input, actor)`: stores approve/discard outcome and creates suggestions.

### Templates And Suggestions

- `listInquiryTemplates()`: lists saved brief templates.
- `createInquiryTemplate(input, actor)`: creates or updates a template by title.
- `deleteInquiryTemplate(identifier)`: deletes a saved template.
- `listSuggestions(status)`: lists triage inbox items.
- `resolveSuggestion(identifier, input, resolvedBy)`: applies or dismisses a suggestion.
- `createSuggestion(input)`: inserts/deduplicates suggestion rows.
- `suggestionFromRow(row)`: maps suggestion JSON.
- `suggestionHash(value)`: stable dedupe hash.
- `applySuggestedTags(suggestion, actor)`: writes accepted tag suggestions.
- `touchTalentField(identifier, field, source, actor)`: marks stale fields as reviewed.
- `maybeCreateTagSuggestions(talent, source)`: proposes tags from profile text.
- `shouldSuggestProfileTags(source)`: gates which writes create tag suggestions.
- `createMatchFeedbackSuggestions(entry)`: turns approved/discarded feedback into reviewable notes/tags.
- `createImportReviewSuggestions(batchId, analyses)`: creates suggestions from import conflicts.
- `generateStalenessSuggestions()`: creates stale-field nudges.
- `shortIsoDate(value)`: date helper for suggestion timestamps.

### Spreadsheet Parsing And Import

- `parseCsv(text, delimiter)`: parses CSV/TSV text.
- `parseDelimitedRows(text, delimiter)`: row-level delimited parser.
- `parseSpreadsheetContent({ filename, text, base64 })`: returns talent records from CSV/TSV/XLSX.
- `parseSpreadsheetRowsContent({ filename, text, base64 })`: returns raw rows for staged review.
- `parseXlsx(buffer)`, `parseXlsxRows(buffer)`: lightweight first-sheet XLSX readers.
- `unzipXlsx(buffer)`: extracts XLSX zip entries.
- `parseSharedStrings(xml)`: parses workbook shared string table.
- `readXlsxCell(attrs, body, sharedStrings)`: resolves one cell value.
- `rowsToTalentRecords(rows, mapping)`: converts rows to import records.
- `mapRawRowToRecord(headers, values, mapping)`: applies column mapping.
- `appendImportValue(existing, value)`: preserves repeated/unmapped values.
- `proposeColumnMapping(rawHeaders)`: auto-detects likely field mapping.
- `normalizeColumnMapping(mapping)`: normalizes reviewed mapping.
- `sanitizeImportTarget(target)`: allows only valid import targets.
- `spreadsheetRecordToTalent(record)`: turns import record into normalized talent input.
- `firstValue(record, keys)`: picks first populated field from aliases.

### Field Policy And Sensitive Data

- `FIELD_POLICY`: schema aliases, allowed label-source headers, and denied sensitive headers.
- `sanitizeProfileFreeText(value, field)`: blocks protected/private attributes from profile text.
- `detectSensitiveProfileText(value)`: finds sensitive patterns.
- `policyCheckClientBrief(brief)`: strips/flags protected criteria before matching.
- `matchableHistory(history)`: filters history before use in matching.
- `classifyImportHeader(header)`: maps spreadsheet headers to safe fields/review/ignore.
- `headerSimilarity`, `stringSimilarity`, `levenshtein`: fuzzy header scoring.
- `roundConfidence`, `roundScore`, `clamp`: numeric helpers.

### Celebrity Label Extraction

- `extractCelebrityLabels(record)`: extracts safe labels from occupation/social/bio columns.
- `splitLabelValues(value)`: splits delimited labels.
- `keywordLabels(value)`: controlled keyword extraction from bio-like text.
- `mergeLabels(explicitTags, inferredLabels)`: combines tags and inferred labels.
- `cleanLabel(value)`: normalizes one label.
- `dedupeLabels(labels)`: removes duplicates.
- `standardizeLabel(label)`: maps variants to canonical labels.
- `isSocialHeader`, `socialPlatformLabel`: detects platform columns.
- `isFollowerHeader`, `followerLabels`, `parseAudienceCount`: audience-size labels.
- `buildImportedNotes(record)`: preserves useful unmapped import values in notes.
- `buildImportedMiscNotes(record)`: creates structured catch-all misc notes.

### CSV/XLSX Utility Helpers

- `columnNameToIndex(name)`: converts Excel column letters to zero-based indexes.
- `normalizeXlsxPath(path)`: canonicalizes workbook paths.
- `decodeXml(value)`: XML entity decode.
- `escapeRegex(value)`: regex escaping.
- `normalizeHeader(value)`: canonical header key.
- `csvCell(value)`: quotes one CSV cell.
- `talentsToCsv(talents)`: converts roster rows to CSV.
- `importCsvFile(path)`: compatibility CSV importer.
- `importSpreadsheetFile(path, actor)`: file-path spreadsheet importer.
- `importTalentRecords(records, actor)`: bulk import/upsert helper.
- `stageSpreadsheetImport(input, actor)`: creates batch and row analyses for review.
- `getImportBatch(identifier)`: returns a staged/committed batch and rows.
- `commitImportBatch(identifier, options, actor)`: writes only safe rows using reviewed mapping.
- `analyzeImportRows(rows, mapping)`: computes per-row status/confidence.
- `markBatchDuplicateRows(analyses)`: flags duplicate names inside one uploaded file.
- `analyzeImportRow(...)`: detects entity matches, diffs, conflicts, confidence.
- `summarizeImportAnalyses(analyses)`: batch summary counts.
- `applySafeImportAnalysis(analysis, actor)`: creates or updates one safe row.
- `safeImportDiff(record, existing)`: decides what can be safely merged.
- `resolveExistingTalent(name, roster)`: fuzzy entity resolution.
- `normalizePersonName`, `personNameSimilarity`, `normalizeComparable`: matching helpers.
- `countBy(items, key)`, `average(values)`: aggregation helpers.

### Export, Backup, Analytics

- `exportCsvFile(path)`: writes roster CSV to disk.
- `backupDatabase(reason, actor)`: creates a consistent SQLite backup snapshot.
- `listBackups(limit)`: lists backup runs.
- `latestBackup()`: returns most recent backup.
- `usageAnalytics()`: computes screen analytics from existing data.
- `pruneOldBackups({ keepDaily, keepMonthly })`: retention cleanup.
- `backupDateFromName(name)`: parses dates from backup filenames.
- `uploadedFilename(photoPath)`: display filename helper.

### Matching Pipeline

- `matchBrief(brief, enrichWeb, actor)`: main entry point. It policy-checks the brief, parses requirements, snapshots roster evidence, runs Claude or fallback matching, normalizes/stores results, and optionally runs live gap search.
- `claudeMatch(...)`: calls Claude Messages API with the roster snapshot, history, requirements, and strict JSON contract.
- `parseJsonFromText(text)`: extracts JSON from Claude output.
- `enrichMatchWithLiveSearch(...)`: runs scoped live web search only for top roster candidates and uncovered must-have requirements.
- `candidateItemsForLiveSearch(result)`: chooses candidates from shortlist/close list.
- `mustHaveRequirementKeys(requirements)`: picks requirements worth checking live.
- `dedupeRequirementKeys(keys)`: removes duplicate live-search requirements.
- `requirementTerms(label)`: expands requirement synonyms.
- `candidateCoversRequirement(talent, requirement)`: checks whether roster data already covers a requirement.
- `findOrFetchLiveSearch(matchHistoryId, gap, actor)`: uses cache or fetches new live evidence.
- `cachedLiveSearch(talentId, requirementKey)`: checks cache freshness.
- `cloneLiveSearchForMatch(...)`: reuses cached evidence for a new match.
- `insertLiveSearchFinding(input)`: stores live-search result.
- `liveSearchFromRow(row)`: maps live-search row.
- `liveSearchQuery(talent, requirement)`: builds scoped query text.
- `runScopedLiveSearch(query, gap)`: asks Claude web search for public professional sources.
- `classifyLiveSearchFinding(gap, findings)`: classifies evidence as supports/contradicts/inconclusive.
- `normalizeLiveConfidence(value)`: normalizes confidence label.
- `anthropicMessages(body)`: raw Anthropic Messages API call.
- `anthropicText(data)`: extracts text from Anthropic response content.
- `applyLiveSearchFindings(result, findings)`: attaches live findings to shortlist items.
- `publicLiveSearchFinding(finding)`: creates public-safe finding payload.
- `liveSearchSource(finding)`: creates claim source object.

### Local Fallback Matcher

- `fallbackMatch(brief, roster, history, requirements, briefPolicy)`: deterministic matcher used when Claude is unavailable.
- `extractTerms(brief)`: keyword extraction plus domain synonyms.
- `interpretCriteria(brief, terms, briefPolicy)`: stated/inferred/ambiguous criteria.
- `parseInquiryRequirements(brief, briefPolicy)`: extracts skills, location, budget, availability, category.
- `parseRequirementList(lower, patterns)`: regex requirement extractor.
- `parseLocationRequirement(lower)`: city/remote extraction.
- `parseBudgetRequirement(lower)`: budget range extraction.
- `parseMoneyAmount(value, suffix)`: handles `k`/`m` money shorthand.
- `parseAvailabilityRequirement(lower)`: date/window extraction.
- `monthNameDateInput`, `monthNameDateRangeInput`, `monthNumber`, `isoDateFromParts`: natural-ish date helpers.
- `normalizeRequirementObject`, `normalizeRequirementItems`, `normalizeRequirementSingleton`: enforce requirement schema.
- `scoreTalent(talent, terms, history, brief, learning, requirements)`: scores each talent, creates claims and score drivers, checks availability.
- `formatAvailabilityWindow(row)`: display helper.
- `sourceForTalentField(talent, field, text, term)`: creates claim source metadata.
- `fallbackLearningProfile(history, terms, brief)`: reweights fallback based on approved/discarded history.
- `fallbackOutcomeSignal(entry)`: outcome signal helper.
- `driversFromClaims(claims)`: converts claims to score drivers.
- `matchHistoryBoost(talent, history, brief)`: boosts talent used successfully in similar briefs.
- `dedupeClaims`, `dedupeScoreDrivers`: remove repeated evidence.
- `fieldLabel(field)`: display labels for fields.
- `talentFieldText(talent, field)`: searchable/citable text for one field.
- `summarizeMiscNotes(notes)`, `summarizePublicSources(sources)`: compress structured data for search/scoring.
- `wikidataSummaryForSources(sources, fallback)`: flattens attached Wikidata data into searchable text.
- `occupationMatchesTag(occupation, tag)`: Wikidata occupation/tag match helper.
- `excerpt(text, term)`: short evidence excerpt.
- `normalizeMatchResult(result)`: enforces result shape, reviewer flag, score drivers, and workflow metadata.
- `normalizeCastingWorkflow(workflow)`: default/normalize hard filters, soft rank basis, verification checklist.
- `normalizeWorkflowFilters(filters)`: validates workflow filter rows.
- `uniqueStrings(values)`: dedupe string helper.
- `normalizeScoreDrivers(drivers, claims)`: canonical score-driver format.

### Wikidata Integration

- `searchWikidataItems(query, limit, context)`: searches Wikidata REST API, filters to humans, ranks by occupation/tag fit.
- `getWikidataItem(itemId)`: fetches one item.
- `summarizeWikidataItem(itemId)`: extracts label, description, aliases, occupations, nationality, image.
- `attachWikidataToTalent(identifier, itemId, actor)`: attaches selected entity as a public source and updates FTS summary.
- `refreshWikidataForTalent(identifier, actor)`: refreshes attached entity immediately.
- `proposeWikidataRefresh(identifier, actor)`: creates a review suggestion with diff.
- `applyWikidataRefreshSuggestion(suggestion, actor)`: writes accepted refresh.
- `wikidataRefreshDiff(current, proposed)`: field-level refresh diff.
- `getWikidataLabel(itemId)`: label lookup helper.
- `wikidataRequest(path)`: REST request with required headers/auth.
- `normalizeWikidataItemId(itemId)`: validates QID.
- `termForLanguage`, `aliasesForLanguage`, `displayTerm`: multilingual value helpers.
- `valuesForProperty`, `statementValue`: extract Wikidata statement values.
- `closeDatabase()`: closes SQLite connection for scripts/tests.

## public/app.js

`public/app.js` is the browser application. It is plain JavaScript, not React. It owns UI state, event binding, rendering, API calls, and toast notifications.

### State And DOM References

- `state`: in-memory frontend cache for user, roster, history, suggestions, templates, analytics, current match, selected import batch, selected talent, and screen state.
- Top-level `const` DOM references cache all key elements from `index.html`.
- `IMPORT_TARGET_OPTIONS`: import mapping options shown during spreadsheet review.
- `screenCopy`: per-screen kicker/title/framing text.

### App Lifecycle

- `init()`: binds events, checks session, pre-fills demo login, hydrates if signed in.
- `bindEvents()`: attaches all click/submit/change listeners.
- `hydrate()`: loads talents, history, suggestions, templates, analytics, then shows the active screen.
- `syncAuth()`: toggles login gate/app shell and updates user badge.
- `showScreen(screen)`: toggles nav/screen active state and runs screen-specific render/load work.

### Data Loading

- `loadTalents()`: fetches roster/search results.
- `loadHistory()`: fetches match history.
- `loadSuggestions()`: fetches triage inbox items.
- `loadTemplates()`: fetches saved inquiry templates.
- `loadAnalytics()`: fetches analytics.

### Templates

- `renderTemplates()`: populates the saved template dropdown.
- `applySelectedTemplate()`: inserts selected brief into the match box.
- `saveInquiryTemplate()`: creates/updates a saved brief template.
- `deleteSelectedTemplate()`: deletes current template.
- `templateTitleFromBrief(brief)`: auto-title helper.

### Roster Rendering

- `scheduleRosterSearch()`: debounces search input.
- `renderRoster()`: renders tag filters and talent cards.
- `renderTalentCard(talent)`: renders one roster card.
- `renderSearchMatches(talent)`: shows why a search result matched.
- `renderPhoto(talent)`: chooses uploaded photo, Wikidata image, or initials placeholder.

### Talent Dialog

- `openTalentDialog(talent)`: opens add/edit modal and fills all fields.
- `renderTalentMiscNotes(notes)`: renders structured misc timeline.
- `renderRateHistory(items)`: renders rate-change history.
- `renderAvailabilityWindows(items, talentId)`: renders held/booked rows.
- `loadSimilarTalents(talentId)`: fetches similar profiles.
- `renderSimilarTalents(items)`: displays similar talent links.
- `renderFieldProvenance(talent)`: shows source/timestamp chips.
- `saveTalent(event)`: first-phase submit handler.
- `submitTalentForm(confirmedDuplicate)`: sends create/update, handles duplicate warnings.
- `searchWikidataForTalent()`: searches Wikidata attach candidates.
- `attachWikidataProfile(itemId, confirmedDuplicate)`: attaches selected entity.
- `renderPublicSources(sources)`: displays attached public sources.
- `deleteCurrentTalent()`: archives selected talent.
- `restoreCurrentTalent()`: restores archived talent.
- `addAvailabilityWindow()`: adds held/booked row.
- `deleteAvailabilityWindow(talentId, availabilityId)`: deletes one availability row.
- `updateTalentInState(talent)`: refreshes local roster cache.

### Spreadsheet Import UI

- `importSpreadsheet()`: reads uploaded file and stages import batch.
- `renderImportReview()`: opens/re-renders import review modal.
- `renderImportStat(label, value)`: one batch statistic.
- `renderImportMapping()`: mapping controls.
- `renderImportTargetOptions(selected)`: mapping dropdown options.
- `renderImportRows()`: list of row analyses.
- `renderImportRow(row)`: one import row preview.
- `commitImportBatch()`: commits safe rows with reviewed mapping.
- `collectImportMapping()`: reads mapping controls.
- `labelForImportTarget(value)`: human label helper.
- `statusLabel(status)`: row status label.
- `percent(value)`: confidence display.
- `averageConfidence(rows)`: batch confidence metric.

### Settings And Analytics

- `exportRoster()`: navigates to CSV download route.
- `exportDatabaseBackup()`: creates/downloads SQLite backup.
- `scanDuplicates()`: triggers duplicate scan.
- `renderAnalytics()`: renders analytics dashboard.
- `analyticsMetric(label, value)`: one metric tile.
- `renderRankedList(items, formatter)`: ranked list helper.

### Match Workflow

- `runMatch(event)`: posts the campaign brief and renders returned match results.
- `renderMatch(payload, container)`: renders brief intake, workflow rail, workflow summary, First Draft, backups/exclusions, review bar.
- `renderWorkflowRail()`: visual six-step workflow from brief to Deep Research.
- `renderRequirements(requirements)`: requirement chips for skills/tone/category/location/budget/timing.
- `renderWorkflowSummary(workflow)`: hard filters, soft-rank basis, Deep Research checklist.
- `requirementChips(label, items)`: chip helper.
- `formatBudget(budget)`: displays parsed budget range.
- `renderCriteria(criteria)`: stated terms, assumptions, and hard-filter review notes.
- `renderShortlistCard(item, historyId)`: one shortlisted talent card.
- `renderLiveSearchFindings(findings)`: Deep Research source-check panel.
- `renderScoreDrivers(drivers)`: inline soft-rank signals.
- `fieldDisplay(field)`: field-name display.
- `renderClaim(claim)`: one claim and source.
- `renderCloseList(items)`: backups/excluded-but-close section.
- `copyClientView(historyId)`: copies sanitized client-ready draft to clipboard.
- `markMatch(historyId, action)`: approve/discard feedback.
- `offerAvailabilityHolds(historyId)`: offers to create hold rows from approved matches with date windows.
- `parseIsoDate(value)`: date helper for approved holds.

### History And Suggestions

- `renderHistory()`: displays previous match logs and selected result.
- `renderSuggestions()`: displays triage inbox.
- `renderSuggestionItem(item)`: one suggestion row.
- `suggestionPrimaryAction(item)`: primary button label.
- `suggestionSecondaryAction(item)`: optional secondary button label.
- `suggestionTypeLabel(type)`: user-facing type label.
- `suggestionBodyFromPayload(item)`: contextual suggestion body.
- `renderSuggestionPayloadChips(item)`: suggestion metadata chips.
- `resolveSuggestionItem(id, action)`: apply/dismiss/merge/refresh suggestion.
- `chooseDuplicatePrimary(item)`: asks which duplicate record should remain primary.

### Generic Browser Helpers

- `api(path, options)`: fetch wrapper with JSON body parsing and auth error handling.
- `fileToDataUrl(file)`: reads photo uploads.
- `fileToBase64(file)`: reads spreadsheet uploads.
- `initials(name)`: fallback photo initials.
- `shortTime(value)`, `shortDate(value)`: timestamp formatters.
- `emptyState(title, body)`: standard empty-state HTML.
- `escapeHtml(value)`: output escaping.
- `showToast(message)`: transient status message.

## public/index.html

`public/index.html` is the static shell the JS fills in.

Major regions:

- `#loginGate`: login form.
- `#appShell`: authenticated application shell.
- `.nav`: left navigation.
- `#rosterScreen`: roster cards, search, tag filters, archive toggle.
- `#matchScreen`: campaign brief form and match results.
- `#historyScreen`: search log/history detail.
- `#suggestionsScreen`: triage inbox.
- `#analyticsScreen`: read-only analytics.
- `#settingsScreen`: login/backup/export/duplicate-scan controls.
- `#talentDialog`: add/edit talent modal with provenance, rate history, availability, misc notes, photo upload, Wikidata lookup.
- `#importDialog`: spreadsheet staging/review modal.
- `#spreadsheetInput`: hidden file input.
- `#toast`: live notification area.

The HTML is intentionally dumb: it defines containers and controls. `public/app.js` owns data, interactions, rendering, and API calls.

## public/styles.css

`public/styles.css` implements the Minimalist Monochrome visual system.

Key sections:

- `:root`: design tokens for colors, typography, lines, and compatibility semantic variables.
- Global reset: `box-sizing`, `[hidden]`, body background, subtle texture layers.
- Buttons/inputs: sharp corners, black/white inversion, accessible focus states.
- Login: editorial sign-in panel.
- App shell/nav/content header: fixed sidebar layout and huge serif screen titles.
- Roster: search toolbar, tag chips, card grid, fixed-boundary profile photos.
- Match: composer, workflow rail, workflow summary, First Draft sections, result cards, claim/source panels.
- History/suggestions/analytics/settings: shared monochrome cards and hover inversion.
- Dialogs/import review: wide modal layout, row review, mapping controls.
- Toast: fixed notification.
- Responsive rules: stack nav/content below `980px`, stack forms/cards below `680px`.

Important recent UI rule:

```css
.talent-photo {
  height: 224px;
  overflow: hidden;
}

.result-card .talent-photo {
  width: 108px;
  height: 108px;
}
```

That keeps roster and shortlist photos inside fixed visual boundaries.

## terminal.mjs

`terminal.mjs` is an alternate CLI surface over the same core logic.

### Key Functions

- `main()`: runs migrations, prints banner/demo info, chooses script mode vs interactive mode, closes database on exit.
- `runCommand(line)`: parses and dispatches commands such as login, add, update, import, list, show, match, history, feedback, seed.
- `requireLogin()`: blocks roster/match commands until logged in.
- `parseTalentFields(rest, firstTokenIsIdentifier)`: parses `field=value` command syntax.
- `parseFeedback(rest)`: parses history feedback command syntax.
- `normalizeKey(value)`: normalizes command field names.
- `stripQuotes(value)`: removes wrapping shell quotes.
- `formatTalentLine(talent)`: compact list output.
- `printTalent(talent, prefix)`: detailed profile output with field timestamps.
- `printMatch(payload)`: terminal rendering of criteria, shortlist, claims, excluded candidates, and reviewer flags.
- `formatHistoryLine(entry)`: one history row display.
- `shortTime(value)`: timestamp formatting.
- `printBanner()`: startup banner.
- `sanitizeCommand(line)`: hides login password in scripted echo.
- `write(text)`: stdout helper.

## scripts/run-core.mjs

Small maintenance wrapper around core functions.

- Reads `process.argv[2]`.
- `migrate`: calls `migrate()` and prints database path.
- `seed`: calls `seed()` and prints record count.
- Always calls `closeDatabase()` in `finally`.

## scripts/import-wikidata-roster.mjs

Bulk demo-data importer using the Wikidata Query Service.

### Key Constants

- `DEFAULT_COUNT`: default import count, 500.
- `DEFAULT_POOL`: candidate pool size before random selection.
- `WIKIDATA_QUERY_URL`: SPARQL endpoint.
- `TALENT_OCCUPATIONS`: occupation QIDs used to build candidate pool.
- `count`, `seed`, `poolSize`: CLI/env-controlled import parameters.

### Key Functions

- Top-level script body: migrates, fetches pool, shuffles by seed, deletes active roster, imports selected records.
- `fetchWikidataTalentPool(limit)`: loops occupation queries and deduplicates QIDs/names.
- `runSparql(query)`: POSTs SPARQL query to Wikidata Query Service.
- `buildTalentQuery(occupation, limit)`: returns a human/person query for one occupation.
- `bindingToTalentRecord(binding, fallbackOccupation)`: maps SPARQL rows into importable talent records with public source metadata.
- `splitOccupations(value)`: parses occupation strings.
- `wikidataId(uri)`: extracts QID from entity URI.
- `normalizePersonName(name)`: stable dedupe key.
- `shuffle(items, seed)`: deterministic Fisher-Yates shuffle.
- `hashSeed(seed)`: seed-to-number hash.
- `nextRandom(state)`: xorshift pseudo-random step.
- `clampNumber(value, fallback, min, max)`: validates CLI numbers.

## How The Main Workflows Operate

### Startup

```text
npm start
  -> platform.mjs startPlatform()
  -> talent-core migrate()
  -> create/update SQLite schema, FTS5 index, admin user
  -> schedule startup/daily backups
  -> serve public/index.html and /api/*
```

### Login

```text
Browser submits username/password
  -> POST /api/login
  -> authenticate()
  -> createSessionCookie()
  -> browser stores HttpOnly signed cookie
  -> frontend hydrate()
```

### Roster Search

```text
User types in search box
  -> loadTalents(q)
  -> GET /api/talents?q=...
  -> listTalents(query)
  -> FTS5 weighted BM25 search when possible
  -> searchScoreTalent adds per-field match provenance
  -> frontend renders matched: tags / notes / Wikidata enrichment chips
```

### Manual Talent Edit

```text
Talent dialog submit
  -> POST/PATCH /api/talents
  -> normalizeTalentInput()
  -> sensitive text policy
  -> duplicate detection if needed
  -> createTalent() or patchTalent()
  -> field_updated_at + field_source updated
  -> FTS5 row updated
  -> frontend updates card
```

### Spreadsheet Import

```text
Upload file
  -> POST /api/import-spreadsheet/stage
  -> parse CSV/TSV/XLSX rows
  -> proposeColumnMapping()
  -> analyzeImportRows()
  -> classify each row as new/safe_update/conflict/needs_review/error
  -> render preview
  -> user confirms mapping
  -> POST /api/import-batches/:id/commit
  -> commit only safe rows
  -> create suggestions for conflicts/review items
```

### Match / Casting Workflow

```text
Campaign brief entered
  -> POST /api/match
  -> policyCheckClientBrief()
  -> parseInquiryRequirements()
  -> list active roster
  -> sourceSnapshotForTalent()
  -> Claude if ANTHROPIC_API_KEY exists, otherwise fallbackMatch()
  -> normalizeMatchResult()
  -> storeMatchHistory()
  -> optional scoped live-search gap check
  -> frontend renders:
       Brief intake
       Hard filters
       Soft-rank basis
       First Draft shortlist
       Excluded/backups
       Deep Research review gate
```

### Feedback And Suggestions

```text
Approve or discard match
  -> PATCH /api/history/:id/feedback
  -> updateHistoryFeedback()
  -> createMatchFeedbackSuggestions()
  -> Suggestions inbox shows reviewable profile notes/tags
  -> user explicitly applies or dismisses
```

### Wikidata Attach

```text
Search public profile from talent dialog
  -> GET /api/wikidata/search?q=...
  -> searchWikidataItems()
  -> fetch summaries
  -> filter to humans
  -> rank by occupation/tag fit
  -> admin selects a result
  -> POST /api/talents/:id/wikidata
  -> attachWikidataToTalent()
  -> public source + wikidata_summary + FTS5 update
```

### Backups

```text
Startup/daily/manual backup
  -> backupDatabase()
  -> SQLite-safe snapshot under backups/
  -> backup_runs row recorded
  -> old backups pruned by retention policy
```

## Design Decisions Worth Knowing

- SQLite is the source of truth; browser state is only a cache.
- FTS5 search weights agency-entered fields above public Wikidata enrichment.
- Archived talent are hidden from active matching/search by default but kept for history integrity.
- The app never auto-writes AI rationale into a profile. It creates suggestions and waits for human confirmation.
- Sensitive/protected-attribute policy runs on imports, notes, match-derived suggestions, and client briefs.
- Claude is optional. The local fallback still produces sourced, review-gated results.
- Live web search is scoped to already-rostered talent and uncovered requirements. It never introduces new people.
- Every match result must retain: `Requires review before external use.`

