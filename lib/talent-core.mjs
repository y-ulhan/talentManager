import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import zlib from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
export const APP_ROOT = dirname(dirname(__filename));

loadEnvFile();

export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
export const DEFAULT_ADMIN_PASSWORD = "terminal-demo";
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
export const CLAUDE_WEB_SEARCH_TOOL = process.env.CLAUDE_WEB_SEARCH_TOOL || "web_search_20250305";
export const CLAUDE_WEB_SEARCH_MAX_USES = Number(process.env.CLAUDE_WEB_SEARCH_MAX_USES || 4);
export const LIVE_SEARCH_TOP_N = Number(process.env.LIVE_SEARCH_TOP_N || 5);
export const LIVE_SEARCH_MAX_GAPS = Number(process.env.LIVE_SEARCH_MAX_GAPS || 10);
export const LIVE_SEARCH_MAX_USES = Number(process.env.LIVE_SEARCH_MAX_USES || 2);
export const LIVE_SEARCH_CACHE_DAYS = Number(process.env.LIVE_SEARCH_CACHE_DAYS || 30);
export const DATABASE_PATH = resolveDatabasePath(process.env.DATABASE_URL || "sqlite:./data/talent-terminal.db");
export const UPLOADS_DIR = resolve(APP_ROOT, "uploads");
export const BACKUP_DIR = resolve(APP_ROOT, process.env.BACKUP_DIR || "backups");
export const WIKIDATA_REST_BASE = process.env.WIKIDATA_REST_BASE || "https://www.wikidata.org/w/rest.php/wikibase/v1";
export const WIKIDATA_ACCESS_TOKEN = process.env.WIKIDATA_ACCESS_TOKEN || "";
export const WIKIDATA_LANGUAGE = process.env.WIKIDATA_LANGUAGE || "en";
export const WIKIDATA_USER_AGENT = process.env.WIKIDATA_USER_AGENT || "TalentMatchTerminal/1.0 (local setup; set WIKIDATA_USER_AGENT with contact)";

mkdirSync(dirname(DATABASE_PATH), { recursive: true });
mkdirSync(UPLOADS_DIR, { recursive: true });
mkdirSync(BACKUP_DIR, { recursive: true });
const db = new DatabaseSync(DATABASE_PATH);

const TALENT_FIELDS = ["name", "tags", "rate", "notes", "misc_notes", "availability", "past_bookings", "photo_path", "wikidata_item_id", "wikidata_summary", "public_sources"];
const PUBLIC_ROSTER_FIELDS = ["tags", "rate", "notes", "misc_notes", "availability", "past_bookings", "public_sources"];
const IMPORTABLE_FIELDS = ["name", "tags", "rate", "notes", "misc_notes", "availability", "past_bookings", "photo_path", "wikidata_item_id"];
const IMPORT_REVIEW_THRESHOLD = Number(process.env.IMPORT_REVIEW_THRESHOLD || 0.72);

export const MATCH_SYSTEM_PROMPT = `
You are Talent Match Terminal, an internal AI matching assistant for a talent agency owner.

Your job is to turn a client brief into a reviewer-ready shortlist from the provided roster only.
Preserve these hard rules:
- Never introduce a person who is not already in the roster.
- Never fabricate a private or personal detail.
- Every claim about a talent must cite either a specific roster field and field timestamp or a public web source returned by the web_search tool.
- Label inferences as inferences and include the stated justification for each inference.
- Web enrichment is optional and only allowed for named roster talent. If you search, search public professional context only and ignore private information.
- Past successful agency matches in the supplied history are stronger evidence than generic assumptions.
- If the client brief contains protected or private attribute requests, do not use those requests as match criteria; flag that they were ignored.
- Every response must include the exact reviewer flag: "Requires review before external use."

Return JSON only. Use this schema:
{
  "requirements": {
    "skills": [{"value": "", "source": "client_brief", "confidence": 0}],
    "tone": [{"value": "", "source": "client_brief", "confidence": 0}],
    "location": {"raw": "", "city": "", "region": "", "remote_ok": null, "confidence": 0},
    "budget_range": {"raw": "", "currency": "USD", "min": null, "max": null, "confidence": 0},
    "availability_window": {"raw": "", "start": "", "end": "", "confidence": 0},
    "category": [{"value": "", "source": "client_brief", "confidence": 0}],
    "flags": []
  },
  "criteria": {
    "stated": [{"criterion": "", "source": "client_brief"}],
    "inferred": [{"criterion": "", "justification": ""}],
    "ambiguous": [{"criterion": "", "reason": ""}]
  },
  "shortlist": [
    {
      "talent_id": 0,
      "name": "",
      "fit": "High|Medium|Low",
      "score": 0,
      "rationale": "",
      "claims": [
        {
          "claim": "",
          "source": {
            "type": "database|external",
            "field": "",
            "value": "",
            "updated_at": "",
            "url": "",
            "title": ""
          }
        }
      ],
      "score_drivers": [
        {
          "label": "",
          "field": "",
          "term": "",
          "weight": 0,
          "source": {
            "type": "database|external",
            "field": "",
            "updated_at": "",
            "url": "",
            "title": ""
          }
        }
      ],
      "cautions": []
    }
  ],
  "excluded_but_close": [
    {"talent_id": 0, "name": "", "reason": "", "missing_or_weak_evidence": []}
  ],
  "flags_for_reviewer": ["Requires review before external use."],
  "review_required": true,
  "review_required_notice": "Requires review before external use.",
  "workflow": {
    "stage": "first_draft",
    "data_sources": ["Roster"],
    "hard_filters": [{"filter": "", "status": "pass|review|fail", "note": ""}],
    "soft_rank_basis": ["Roster priority", "theme connection", "audience fit"],
    "verification_required": ["Deep Research", "COI recheck", "source review"]
  }
}
`.trim();

function loadEnvFile() {
  const envPath = resolve(dirname(dirname(__filename)), ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function resolveDatabasePath(databaseUrl) {
  if (databaseUrl.startsWith("sqlite:")) {
    const value = databaseUrl.slice("sqlite:".length);
    return resolve(APP_ROOT, value || "./data/talent-terminal.db");
  }
  if (!databaseUrl.includes("://")) {
    return resolve(APP_ROOT, databaseUrl);
  }
  throw new Error("This local terminal build supports sqlite DATABASE_URL values, for example sqlite:./data/talent-terminal.db.");
}

export function migrate() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS talents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      tags_json TEXT NOT NULL DEFAULT '[]',
      rate TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      misc_notes_json TEXT NOT NULL DEFAULT '[]',
      availability TEXT NOT NULL DEFAULT '',
      past_bookings TEXT NOT NULL DEFAULT '',
      photo_path TEXT NOT NULL DEFAULT '',
      wikidata_item_id TEXT NOT NULL DEFAULT '',
      wikidata_summary TEXT NOT NULL DEFAULT '',
      public_sources_json TEXT NOT NULL DEFAULT '[]',
      field_updated_at_json TEXT NOT NULL DEFAULT '{}',
      field_source_json TEXT NOT NULL DEFAULT '{}',
      archived_at TEXT NOT NULL DEFAULT '',
      created_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS talent_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      talent_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (talent_id) REFERENCES talents(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS match_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brief TEXT NOT NULL,
      criteria_json TEXT NOT NULL DEFAULT '{}',
      requirements_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL,
      roster_snapshot_json TEXT NOT NULL,
      enrich_web INTEGER NOT NULL DEFAULT 0,
      model_source TEXT NOT NULL,
      model_name TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT '',
      feedback TEXT NOT NULL DEFAULT '',
      created_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS rate_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      talent_id INTEGER NOT NULL,
      old_rate TEXT NOT NULL DEFAULT '',
      new_rate TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      changed_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (talent_id) REFERENCES talents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inquiry_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL UNIQUE COLLATE NOCASE,
      brief TEXT NOT NULL,
      created_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'staged',
      raw_headers_json TEXT NOT NULL DEFAULT '[]',
      proposed_mapping_json TEXT NOT NULL DEFAULT '[]',
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS import_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      row_number INTEGER NOT NULL,
      raw_row_json TEXT NOT NULL DEFAULT '[]',
      normalized_record_json TEXT NOT NULL DEFAULT '{}',
      analysis_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'needs_review',
      confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      talent_id INTEGER,
      match_id INTEGER,
      import_batch_id INTEGER,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      content_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT '',
      resolved_by TEXT NOT NULL DEFAULT '',
      resolution TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (talent_id) REFERENCES talents(id) ON DELETE CASCADE,
      FOREIGN KEY (match_id) REFERENCES match_history(id) ON DELETE SET NULL,
      FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS backup_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS match_live_search (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_history_id INTEGER,
      talent_id INTEGER NOT NULL,
      requirement_key TEXT NOT NULL,
      query TEXT NOT NULL,
      findings_json TEXT NOT NULL DEFAULT '[]',
      confidence TEXT NOT NULL DEFAULT 'inconclusive',
      rationale TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ok',
      fetched_at TEXT NOT NULL,
      FOREIGN KEY (match_history_id) REFERENCES match_history(id) ON DELETE CASCADE,
      FOREIGN KEY (talent_id) REFERENCES talents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_talents_name ON talents (name);
    CREATE INDEX IF NOT EXISTS idx_talent_availability_talent_id ON talent_availability (talent_id, start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_match_history_created_at ON match_history (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rate_history_talent_id ON rate_history (talent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_import_rows_batch_id ON import_rows (batch_id);
    CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions (status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_suggestions_hash ON suggestions (content_hash, status);
    CREATE INDEX IF NOT EXISTS idx_backup_runs_created_at ON backup_runs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_match_live_search_match ON match_live_search (match_history_id);
    CREATE INDEX IF NOT EXISTS idx_match_live_search_cache ON match_live_search (talent_id, requirement_key, fetched_at DESC);
  `);
  ensureColumn("talents", "photo_path", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("talents", "wikidata_item_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("talents", "wikidata_summary", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("talents", "public_sources_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("talents", "misc_notes_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("talents", "field_source_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("talents", "archived_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("talents", "created_by_user_id", "INTEGER");
  ensureColumn("talents", "updated_by_user_id", "INTEGER");
  ensureColumn("match_history", "requirements_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("match_history", "created_by_user_id", "INTEGER");
  ensureColumn("match_history", "updated_by_user_id", "INTEGER");
  ensureColumn("inquiry_templates", "created_by_user_id", "INTEGER");
  ensureColumn("inquiry_templates", "updated_by_user_id", "INTEGER");
  ensureColumn("import_batches", "created_by_user_id", "INTEGER");
  ensureColumn("import_batches", "updated_by_user_id", "INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_talents_archived_at ON talents (archived_at)");
  backfillWikidataSummaries();
  ensureTalentSearchIndex();
  ensureAdminUser();
  backfillActorReferences();
  ensureWikidataUniqueIndex();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function backfillWikidataSummaries() {
  const rows = db.prepare("SELECT id, wikidata_summary, public_sources_json FROM talents").all();
  const update = db.prepare("UPDATE talents SET wikidata_summary = ? WHERE id = ?");
  for (const row of rows) {
    if (String(row.wikidata_summary || "").trim()) continue;
    const summary = wikidataSummaryForSources(asJson(row.public_sources_json, []));
    if (summary) update.run(summary, row.id);
  }
}

function ensureTalentSearchIndex() {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'talent_fts'").get();
  if (existing?.sql) db.exec("DROP TABLE talent_fts");
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS talent_fts USING fts5(
      name,
      tags,
      notes,
      past_bookings,
      misc_notes,
      wikidata_summary,
      tokenize='unicode61 remove_diacritics 2'
    );
  `);
  rebuildTalentSearchIndex();
}

function rebuildTalentSearchIndex() {
  const insert = db.prepare(`
    INSERT INTO talent_fts (rowid, name, tags, notes, past_bookings, misc_notes, wikidata_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const talent of db.prepare("SELECT * FROM talents WHERE archived_at = '' ORDER BY id").all().map(talentFromRow)) {
    insert.run(
      talent.id,
      talent.name,
      talent.tags.join(" "),
      talent.notes,
      talent.past_bookings,
      summarizeMiscNotes(talent.misc_notes),
      talent.wikidata_summary || wikidataSummaryForSources(talent.public_sources)
    );
  }
}

function updateTalentSearchIndex(talent) {
  removeTalentSearchIndex(talent.id);
  db.prepare(`
    INSERT INTO talent_fts (rowid, name, tags, notes, past_bookings, misc_notes, wikidata_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    talent.id,
    talent.name,
    talent.tags.join(" "),
    talent.notes,
    talent.past_bookings,
    summarizeMiscNotes(talent.misc_notes),
    talent.wikidata_summary || wikidataSummaryForSources(talent.public_sources)
  );
}

function removeTalentSearchIndex(talentId) {
  db.prepare("DELETE FROM talent_fts WHERE rowid = ?").run(Number(talentId));
}

function ensureAdminUser() {
  const nowValue = now();
  const requestedPassword = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(ADMIN_USERNAME);
  if (!existing) {
    const { hash, salt } = hashPassword(requestedPassword);
    db.prepare(`
      INSERT INTO users (username, password_hash, salt, role, created_at, updated_at)
      VALUES (?, ?, ?, 'owner', ?, ?)
    `).run(ADMIN_USERNAME, hash, salt, nowValue, nowValue);
    return;
  }

  if (process.env.ADMIN_PASSWORD) {
    const { hash, salt } = hashPassword(process.env.ADMIN_PASSWORD);
    db.prepare("UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?")
      .run(hash, salt, nowValue, existing.id);
  }
}

function adminUserId() {
  return Number(db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(ADMIN_USERNAME)?.id || 0) || null;
}

function actorUserId(actor = null) {
  if (actor && typeof actor === "object" && Number(actor.id)) return Number(actor.id);
  if (Number(actor)) return Number(actor);
  return adminUserId();
}

function actorLabel(actor = null) {
  if (actor && typeof actor === "object" && actor.username) return String(actor.username);
  if (actor && typeof actor === "string") return actor;
  return ADMIN_USERNAME;
}

function backfillActorReferences() {
  const adminId = adminUserId();
  if (!adminId) return;
  for (const table of ["talents", "match_history", "inquiry_templates", "import_batches"]) {
    db.prepare(`UPDATE ${table} SET created_by_user_id = COALESCE(created_by_user_id, ?)`).run(adminId);
    db.prepare(`UPDATE ${table} SET updated_by_user_id = COALESCE(updated_by_user_id, ?)`).run(adminId);
  }
}

function ensureWikidataUniqueIndex() {
  const duplicateGroups = db.prepare(`
    SELECT wikidata_item_id, group_concat(id) AS ids, count(*) AS count
    FROM talents
    WHERE wikidata_item_id != '' AND archived_at = ''
    GROUP BY wikidata_item_id
    HAVING count(*) > 1
  `).all();
  if (duplicateGroups.length) {
    for (const group of duplicateGroups) {
      const ids = String(group.ids || "").split(",").map(Number).filter(Boolean);
      for (let index = 0; index < ids.length - 1; index += 1) {
        createPossibleDuplicateSuggestion(ids[index], ids[index + 1], {
          score: 1,
          matched_fields: [`Wikidata ${group.wikidata_item_id}`],
          reason: "Same active Wikidata entity."
        });
      }
    }
    return;
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_talents_active_wikidata_item_id
    ON talents (wikidata_item_id)
    WHERE wikidata_item_id != '' AND archived_at = ''
  `);
}

export function seed() {
  migrate();
  const rows = [
    {
      name: "Ari Lane",
      tags: ["eyewear", "glasses", "host", "on-camera", "lifestyle"],
      rate: "$4,500/day",
      notes: "Wears prescription glasses in current portfolio. Warm delivery and clean product-demo reads.",
      availability: "Available weekdays with two weeks notice.",
      past_bookings: "Optical launch explainer; direct-to-consumer skincare spokesperson."
    },
    {
      name: "Maya Chen",
      tags: ["fitness", "wellness", "doctor-family", "bilingual", "social video"],
      rate: "$6,000/day",
      notes: "Bilingual English/Mandarin creator with polished short-form scripts. Parent is an optometrist; verify before external use.",
      availability: "Limited next month; open for remote recording.",
      past_bookings: "Wearable health app campaign; boutique eyewear social reels."
    },
    {
      name: "Jon Bell",
      tags: ["sports", "dad", "comedy", "voiceover", "family"],
      rate: "$3,200/day",
      notes: "Approachable comedic timing, strong voiceover booth setup, family-oriented brand fit.",
      availability: "Open this week.",
      past_bookings: "Regional grocery radio; kids snack social videos."
    },
    {
      name: "Priya Shah",
      tags: ["fashion", "luxury", "editorial", "glasses", "runway"],
      rate: "$8,500/day",
      notes: "Editorial model who often styles optical frames in portfolio shoots. Minimal spokesperson history.",
      availability: "Travel hold on the 14th-18th; otherwise open.",
      past_bookings: "Luxury accessory campaign; magazine eyewear editorial."
    },
    {
      name: "Elena Torres",
      tags: ["beauty", "spokesperson", "mom", "healthcare", "broadcast"],
      rate: "$7,000/day",
      notes: "Broadcast-trained spokesperson with healthcare category comfort and strong teleprompter reads.",
      availability: "Available for studio days after next Friday.",
      past_bookings: "Dental care national spot; pharmacy explainer series."
    }
  ];

  return rows.map((row) => upsertTalent(row, "seed"));
}

export function authenticate(username, password) {
  migrate();
  const user = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(String(username || "").trim());
  if (!user || !verifyPassword(String(password || ""), user)) {
    return null;
  }
  return { id: user.id, username: user.username, role: user.role };
}

function hashPassword(password, providedSalt) {
  const salt = providedSalt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex");
  return { hash, salt };
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return timingSafeEqual(hash, user.password_hash);
}

function now() {
  return new Date().toISOString();
}

function asJson(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeTags(value) {
  const safeTag = (tag) => {
    const cleaned = String(tag).trim();
    return cleaned && !detectSensitiveProfileText(cleaned).length ? cleaned : "";
  };
  if (Array.isArray(value)) {
    return value.map(safeTag).filter(Boolean);
  }
  if (!value) return [];
  return String(value)
    .split(/[;,]/)
    .map(safeTag)
    .filter(Boolean);
}

function normalizeTalentInput(input) {
  const notes = sanitizeProfileFreeText(input.notes, "notes");
  const pastBookings = sanitizeProfileFreeText(input.past_bookings || input.pastBookings || input.past || "", "past_bookings");
  return {
    name: String(input.name || "").trim(),
    tags: normalizeTags(input.tags),
    rate: String(input.rate || "").trim(),
    notes,
    misc_notes: normalizeMiscNotes(input.misc_notes || input.miscNotes),
    availability: String(input.availability || "").trim(),
    past_bookings: pastBookings,
    photo_path: String(input.photo_path || input.photoPath || "").trim(),
    wikidata_item_id: String(input.wikidata_item_id || input.wikidataItemId || "").trim(),
    public_sources: normalizePublicSources(input.public_sources || input.publicSources),
    wikidata_summary: String(input.wikidata_summary || input.wikidataSummary || "").trim()
  };
}

function normalizePublicSources(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((source) => source && typeof source === "object");
  if (typeof value === "string") return asJson(value, []);
  return [];
}

function normalizeMiscNotes(value) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? asJson(value, [])
      : [];
  return rawItems
    .map((item) => normalizeMiscNoteEntry(item))
    .filter(Boolean)
    .slice(0, 250);
}

function normalizeMiscNoteEntry(item) {
  if (!item) return null;
  const note = typeof item === "string" ? item : item.note;
  const trimmedNote = sanitizeProfileFreeText(note, "misc_notes");
  if (!trimmedNote) return null;
  const date = String(item.date || item.added_at || now()).trim();
  return {
    id: String(item.id || stableNoteId(trimmedNote, date)).trim(),
    note: trimmedNote,
    source: String(item.source || "manual").trim(),
    match_id: item.match_id || item.matchId || null,
    import_batch_id: item.import_batch_id || item.importBatchId || null,
    field: item.field ? String(item.field).trim() : "",
    added_by: String(item.added_by || item.addedBy || "").trim(),
    date,
    metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {}
  };
}

function makeMiscNote({ note, source = "manual", match_id = null, import_batch_id = null, field = "", added_by = "", metadata = {}, date = now() }) {
  return normalizeMiscNoteEntry({ note, source, match_id, import_batch_id, field, added_by, metadata, date });
}

function mergeMiscNotes(...groups) {
  const merged = [];
  const seen = new Set();
  for (const item of groups.flatMap((group) => normalizeMiscNotes(group))) {
    const key = `${item.source}|${item.match_id || ""}|${item.import_batch_id || ""}|${item.field || ""}|${normalizeComparable(item.note)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(-250);
}

function stableNoteId(note, date) {
  return crypto.createHash("sha1").update(`${date}|${note}`).digest("hex").slice(0, 12);
}

function talentFromRow(row) {
  if (!row) return null;
  const fieldUpdatedAt = asJson(row.field_updated_at_json, {});
  const fieldSource = normalizeFieldSource(row.field_source_json, "legacy");
  return {
    id: row.id,
    name: row.name,
    tags: asJson(row.tags_json, []),
    rate: row.rate || "",
    notes: row.notes || "",
    misc_notes: normalizeMiscNotes(row.misc_notes_json || "[]"),
    availability: row.availability || "",
    past_bookings: row.past_bookings || "",
    photo_path: row.photo_path || "",
    photo_url: row.photo_path ? `/${row.photo_path.replaceAll("\\", "/")}` : "",
    wikidata_item_id: row.wikidata_item_id || "",
    wikidata_summary: row.wikidata_summary || "",
    public_sources: asJson(row.public_sources_json, []),
    rate_history: getRateHistory(row.id),
    availability_windows: listTalentAvailability(row.id),
    field_updated_at: fieldUpdatedAt,
    field_source: fieldSource,
    archived_at: row.archived_at || "",
    created_by_user_id: row.created_by_user_id || null,
    updated_by_user_id: row.updated_by_user_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizeFieldSource(value, fallback = "unknown") {
  const parsed = typeof value === "string" ? asJson(value, {}) : value && typeof value === "object" ? value : {};
  return Object.fromEntries(TALENT_FIELDS.map((field) => [field, parsed[field] || fallback]));
}

function getRateHistory(talentId, limit = 12) {
  return db.prepare(`
    SELECT id, talent_id, old_rate, new_rate, source, changed_by, created_at
    FROM rate_history
    WHERE talent_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(Number(talentId), Number(limit) || 12);
}

function recordRateHistory(talentId, oldRate, newRate, source = "unknown", changedBy = "") {
  const previous = String(oldRate || "").trim();
  const next = String(newRate || "").trim();
  if (previous === next) return null;
  const timestamp = now();
  const insert = db.prepare(`
    INSERT INTO rate_history (talent_id, old_rate, new_rate, source, changed_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(Number(talentId), previous, next, String(source || "unknown"), String(changedBy || ""), timestamp);
  return db.prepare("SELECT * FROM rate_history WHERE id = ?").get(Number(insert.lastInsertRowid));
}

function availabilityFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    talent_id: row.talent_id,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status,
    note: row.note || "",
    created_by_user_id: row.created_by_user_id || null,
    updated_by_user_id: row.updated_by_user_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function listTalentAvailability(talentId, options = {}) {
  const includePast = Boolean(options.includePast);
  const rows = includePast
    ? db.prepare(`
      SELECT * FROM talent_availability
      WHERE talent_id = ?
      ORDER BY start_date ASC, id ASC
    `).all(Number(talentId))
    : db.prepare(`
      SELECT * FROM talent_availability
      WHERE talent_id = ? AND end_date >= date('now')
      ORDER BY start_date ASC, id ASC
    `).all(Number(talentId));
  return rows.map(availabilityFromRow);
}

function normalizeAvailabilityInput(input = {}) {
  const startDate = normalizeDateInput(input.start_date || input.startDate || input.start);
  const endDate = normalizeDateInput(input.end_date || input.endDate || input.end || input.start_date || input.startDate || input.start);
  const status = String(input.status || "").trim().toLowerCase();
  const allowedStatuses = new Set(["booked", "held"]);
  if (!startDate || !endDate) throw new Error("Availability start and end dates are required.");
  if (endDate < startDate) throw new Error("Availability end date must be on or after start date.");
  if (!allowedStatuses.has(status)) throw new Error("Availability status must be booked or held.");
  return {
    start_date: startDate,
    end_date: endDate,
    status,
    note: sanitizeProfileFreeText(input.note || "", "availability")
  };
}

function normalizeDateInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error("Dates must use YYYY-MM-DD.");
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error("Invalid date.");
  }
  return text;
}

export function addTalentAvailability(identifier, input = {}, actor = null) {
  const talent = getTalent(identifier, { includeArchived: true });
  if (!talent) throw new Error("Talent not found.");
  const row = normalizeAvailabilityInput(input);
  const timestamp = now();
  const userId = actorUserId(actor);
  const insert = db.prepare(`
    INSERT INTO talent_availability
      (talent_id, start_date, end_date, status, note, created_by_user_id, updated_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(talent.id, row.start_date, row.end_date, row.status, row.note, userId, userId, timestamp, timestamp);
  return availabilityFromRow(db.prepare("SELECT * FROM talent_availability WHERE id = ?").get(Number(insert.lastInsertRowid)));
}

export function deleteTalentAvailability(identifier, availabilityId) {
  const talent = getTalent(identifier, { includeArchived: true });
  if (!talent) throw new Error("Talent not found.");
  const existing = db.prepare("SELECT * FROM talent_availability WHERE id = ? AND talent_id = ?").get(Number(availabilityId), talent.id);
  if (!existing) throw new Error("Availability entry not found.");
  db.prepare("DELETE FROM talent_availability WHERE id = ?").run(Number(availabilityId));
  return availabilityFromRow(existing);
}

function availabilityOverlaps(talent, requirement = {}) {
  const window = normalizeRequirementDateWindow(requirement);
  if (!window) return { booked: [], held: [] };
  const rows = db.prepare(`
    SELECT * FROM talent_availability
    WHERE talent_id = ?
      AND start_date <= ?
      AND end_date >= ?
    ORDER BY start_date ASC, id ASC
  `).all(Number(talent.id), window.end, window.start).map(availabilityFromRow);
  return {
    booked: rows.filter((row) => row.status === "booked"),
    held: rows.filter((row) => row.status === "held")
  };
}

function normalizeRequirementDateWindow(requirement = {}) {
  const raw = requirement.raw || "";
  const start = softDateInput(requirement.start || requirement.start_date || raw);
  const end = softDateInput(requirement.end || requirement.end_date || raw) || start;
  if (!start || !end) return null;
  return end < start ? { start: end, end: start } : { start, end };
}

function softDateInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso) return iso[1];
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);
  if (slash) {
    const currentYear = new Date().getFullYear();
    const year = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : currentYear;
    const month = String(Number(slash[1])).padStart(2, "0");
    const day = String(Number(slash[2])).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const monthDate = monthNameDateInput(text);
  if (monthDate) return monthDate;
  return "";
}

export function getTalent(identifier, options = {}) {
  const numericId = Number(identifier);
  const includeArchived = Boolean(options.includeArchived);
  const row = Number.isInteger(numericId) && numericId > 0
    ? db.prepare(`SELECT * FROM talents WHERE id = ? ${includeArchived ? "" : "AND archived_at = ''"}`).get(numericId)
    : db.prepare(`SELECT * FROM talents WHERE name = ? COLLATE NOCASE ${includeArchived ? "" : "AND archived_at = ''"}`).get(String(identifier || "").trim());
  return talentFromRow(row);
}

export function listTalents(query = "", options = {}) {
  const needle = String(query || "").trim().toLowerCase();
  const includeArchived = Boolean(options.includeArchived);
  const onlyArchived = Boolean(options.archivedOnly);
  const archiveWhere = onlyArchived ? "talents.archived_at <> ''" : includeArchived ? "1 = 1" : "talents.archived_at = ''";
  if (!needle) {
    return db.prepare(`SELECT * FROM talents WHERE ${archiveWhere} ORDER BY name ASC`).all().map(talentFromRow);
  }
  if (includeArchived || onlyArchived) {
    return db.prepare(`SELECT * FROM talents WHERE ${archiveWhere} ORDER BY name ASC`).all()
      .map(talentFromRow)
      .map((talent) => ({ talent, search: searchScoreTalent(talent, needle) }))
      .filter((entry) => entry.search.score > 0)
      .sort((a, b) => b.search.score - a.search.score || a.talent.name.localeCompare(b.talent.name))
      .slice(0, 50)
      .map((entry) => ({
        ...entry.talent,
        search_rank: roundScore(entry.search.score),
        search_matches: entry.search.matches
      }));
  }
  try {
    const ftsQuery = toFtsQuery(needle);
    const rows = db.prepare(`
      SELECT talents.*, bm25(talent_fts, 5.0, 4.0, 3.0, 2.5, 2.0, 1.0) AS fts_rank
      FROM talent_fts
      JOIN talents ON talents.id = talent_fts.rowid
      WHERE talent_fts MATCH ? AND ${archiveWhere}
      ORDER BY fts_rank ASC, talents.name COLLATE NOCASE ASC
      LIMIT 50
    `).all(ftsQuery);
    return rows.map((row) => {
      const talent = talentFromRow(row);
      const search = searchScoreTalent(talent, needle);
      return {
        ...talent,
        search_rank: roundScore(Math.max(search.score, Math.abs(Number(row.fts_rank || 0)))),
        search_matches: search.matches
      };
    });
  } catch {
    const talents = db.prepare(`SELECT * FROM talents WHERE ${archiveWhere} ORDER BY name ASC`).all().map(talentFromRow);
    return talents
      .map((talent) => ({ talent, search: searchScoreTalent(talent, needle) }))
      .filter((entry) => entry.search.score > 0)
      .sort((a, b) => b.search.score - a.search.score || a.talent.name.localeCompare(b.talent.name))
      .slice(0, 50)
      .map((entry) => ({
        ...entry.talent,
        search_rank: roundScore(entry.search.score),
        search_matches: entry.search.matches
      }));
  }
}

export function similarTalents(identifier, limit = 5) {
  const talent = getTalent(identifier, { includeArchived: true });
  if (!talent || talent.archived_at) return [];
  const terms = dedupeLabels([
    ...talent.tags,
    ...extractTerms([talent.notes, talent.past_bookings, talent.wikidata_summary].join(" "))
  ]).slice(0, 12);
  if (terms.length < 2) return [];
  const query = terms.map((term) => `"${String(term).replaceAll('"', '""')}"`).join(" OR ");
  const rows = db.prepare(`
    SELECT talents.*, bm25(talent_fts, 5.0, 4.0, 3.0, 2.5, 2.0, 1.0) AS fts_rank
    FROM talent_fts
    JOIN talents ON talents.id = talent_fts.rowid
    WHERE talent_fts MATCH ? AND talents.id != ? AND talents.archived_at = ''
    ORDER BY fts_rank ASC, talents.name COLLATE NOCASE ASC
    LIMIT ?
  `).all(query, talent.id, Math.min(Number(limit) || 5, 10));
  return rows.map((row) => {
    const candidate = talentFromRow(row);
    const sharedTags = (candidate.tags || []).filter((tag) => talent.tags.includes(tag));
    const search = searchScoreTalent(candidate, terms.join(" "));
    return {
      id: candidate.id,
      name: candidate.name,
      rate: candidate.rate,
      tags: candidate.tags.slice(0, 6),
      shared_tags: sharedTags.slice(0, 5),
      reason: sharedTags.length
        ? `Shared tags: ${sharedTags.slice(0, 5).join(", ")}`
        : search.matches?.[0] ? `Similar ${search.matches[0].label}` : "Similar profile text",
      search_matches: search.matches.slice(0, 3)
    };
  });
}

function toFtsQuery(query) {
  return String(query || "")
    .split(/\s+/)
    .map((term) => term.replace(/[^a-z0-9_\-\p{L}\p{N}]/giu, "").trim())
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" AND ");
}

function searchScoreTalent(talent, query) {
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 8);
  const fields = [
    ["name", talent.name, 5],
    ["tags", talent.tags.join(" "), 4],
    ["notes", talent.notes, 3],
    ["past_bookings", talent.past_bookings, 2.5],
    ["misc_notes", summarizeMiscNotes(talent.misc_notes), 2],
    ["availability", talent.availability, 1.3],
    ["wikidata_summary", talent.wikidata_summary || wikidataSummaryForSources(talent.public_sources), 1]
  ];
  let score = 0;
  const matches = [];
  for (const [field, rawText, weight] of fields) {
    const text = String(rawText || "");
    const lower = text.toLowerCase();
    const matched = terms.filter((term) => lower.includes(term));
    if (!matched.length) continue;
    const exactBonus = lower.includes(query) ? 1.5 : 1;
    const fieldScore = weight * matched.length * exactBonus;
    score += fieldScore;
    matches.push({
      field,
      label: searchFieldLabel(field),
      source: field === "wikidata_summary" ? "wikidata_enrichment" : "roster",
      terms: matched,
      excerpt: excerpt(text, matched[0])
    });
  }
  return { score, matches };
}

function searchFieldLabel(field) {
  if (field === "wikidata_summary") return "Wikidata enrichment";
  if (field === "past_bookings") return "past bookings";
  if (field === "misc_notes") return "misc notes";
  return fieldLabel(field);
}

export function findPotentialDuplicates(input = {}, options = {}) {
  const normalized = normalizeTalentInput(input);
  const excludeId = Number(options.excludeId || options.exclude_id || 0);
  const threshold = Number(options.threshold || 0.82);
  const incomingIds = talentEntityIds(normalized);
  const incomingName = normalizePersonName(normalized.name);
  const candidates = [];

  for (const talent of listTalents("", { includeArchived: true })) {
    if (excludeId && Number(talent.id) === excludeId) continue;
    const candidateIds = talentEntityIds(talent);
    const sharedEntityId = [...incomingIds].find((id) => candidateIds.has(id));
    const nameConfidence = incomingName
      ? personNameSimilarity(incomingName, normalizePersonName(talent.name))
      : 0;
    const confidence = sharedEntityId ? 1 : nameConfidence;
    if (!sharedEntityId && confidence < threshold) continue;
    candidates.push({
      id: talent.id,
      name: talent.name,
      confidence: roundConfidence(confidence),
      type: sharedEntityId ? "wikidata_entity" : confidence === 1 ? "exact_name" : "fuzzy_name",
      reason: sharedEntityId
        ? `Same Wikidata entity ${sharedEntityId}.`
        : `Name similarity ${Math.round(confidence * 100)}%.`,
      wikidata_item_id: talent.wikidata_item_id,
      archived_at: talent.archived_at || "",
      rate: talent.rate,
      tags: talent.tags.slice(0, 8),
      updated_at: talent.updated_at
    });
  }

  const seen = new Set();
  return candidates
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name))
    .filter((candidate) => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    })
    .slice(0, 6);
}

export function scanDuplicateTalents(options = {}) {
  const threshold = Number(options.threshold || 0.86);
  const talents = listTalents("", { includeArchived: Boolean(options.includeArchived) });
  const created = [];
  for (let leftIndex = 0; leftIndex < talents.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < talents.length; rightIndex += 1) {
      const score = duplicateTalentScore(talents[leftIndex], talents[rightIndex]);
      if (score.score < threshold) continue;
      created.push(createPossibleDuplicateSuggestion(talents[leftIndex].id, talents[rightIndex].id, score));
    }
  }
  return {
    scanned: talents.length,
    suggestions: created.filter(Boolean),
    threshold
  };
}

function duplicateTalentScore(left, right) {
  const leftIds = talentEntityIds(left);
  const rightIds = talentEntityIds(right);
  const sharedEntity = [...leftIds].find((id) => rightIds.has(id));
  const matchedFields = [];
  if (sharedEntity) matchedFields.push(`Wikidata ${sharedEntity}`);
  const nameScore = personNameSimilarity(normalizePersonName(left.name), normalizePersonName(right.name));
  if (nameScore >= 0.72) matchedFields.push(`name ${Math.round(nameScore * 100)}%`);
  const tagOverlap = (left.tags || []).filter((tag) => (right.tags || []).includes(tag));
  if (tagOverlap.length) matchedFields.push(`tags: ${tagOverlap.slice(0, 5).join(", ")}`);
  if (left.rate && right.rate && normalizeComparable(left.rate) === normalizeComparable(right.rate)) {
    matchedFields.push("same rate");
  }
  const softScore = Math.min(0.98, nameScore * 0.82 + Math.min(tagOverlap.length, 4) * 0.04 + (matchedFields.includes("same rate") ? 0.04 : 0));
  return {
    score: sharedEntity ? 1 : roundConfidence(softScore),
    matched_fields: matchedFields,
    reason: sharedEntity ? "Same Wikidata entity." : matchedFields.join("; ")
  };
}

function createPossibleDuplicateSuggestion(leftId, rightId, score = {}) {
  const left = getTalent(leftId, { includeArchived: true });
  const right = getTalent(rightId, { includeArchived: true });
  if (!left || !right) return null;
  return createSuggestion({
    type: "possible_duplicate",
    talent_id: left.id,
    title: `Possible duplicate: ${left.name} / ${right.name}`,
    body: score.reason || "These roster records look like they may refer to the same person.",
    payload: {
      default_action: "dismiss",
      talent_id_a: left.id,
      talent_id_b: right.id,
      talent_a: left.name,
      talent_b: right.name,
      score: roundConfidence(score.score || 0),
      matched_fields: score.matched_fields || []
    },
    source: "duplicate_scan",
    confidence: roundConfidence(score.score || 0)
  });
}

export function mergeDuplicateTalents(primaryId, secondaryId, actor = null) {
  const primary = getTalent(primaryId, { includeArchived: true });
  const secondary = getTalent(secondaryId, { includeArchived: true });
  if (!primary || !secondary) throw new Error("Both talent records are required for merge.");
  if (Number(primary.id) === Number(secondary.id)) throw new Error("Choose two different talent records to merge.");
  if (primary.archived_at) throw new Error("Primary record must be active.");

  const timestamp = now();
  const actorLabelValue = actorLabel(actor);
  const conflictNotes = mergeConflictNotes(primary, secondary, actorLabelValue, timestamp);
  const merged = {
    tags: dedupeLabels([...(primary.tags || []), ...(secondary.tags || [])]),
    rate: primary.rate || secondary.rate,
    notes: mergeLongText(primary.notes, secondary.notes, "Merged notes from duplicate record"),
    misc_notes: mergeMiscNotes(
      primary.misc_notes,
      secondary.misc_notes,
      conflictNotes,
      [makeMiscNote({
        note: `Merged duplicate roster record "${secondary.name}" (#${secondary.id}) into this profile.`,
        source: "duplicate_merge",
        field: "merge_audit",
        added_by: actorLabelValue,
        date: timestamp,
        metadata: { primary_id: primary.id, secondary_id: secondary.id }
      })]
    ),
    availability: primary.availability || secondary.availability,
    past_bookings: mergeLongText(primary.past_bookings, secondary.past_bookings, "Merged past bookings from duplicate record"),
    photo_path: primary.photo_path || secondary.photo_path,
    wikidata_item_id: primary.wikidata_item_id || secondary.wikidata_item_id,
    public_sources: mergePublicSources(primary.public_sources, secondary.public_sources),
    wikidata_summary: primary.wikidata_summary || secondary.wikidata_summary
  };
  const patched = patchTalent(primary.id, merged, "duplicate_merge", actor).talent;

  db.prepare("UPDATE rate_history SET talent_id = ? WHERE talent_id = ?").run(primary.id, secondary.id);
  db.prepare("UPDATE talent_availability SET talent_id = ?, updated_by_user_id = ?, updated_at = ? WHERE talent_id = ?")
    .run(primary.id, actorUserId(actor), timestamp, secondary.id);
  db.prepare("UPDATE suggestions SET talent_id = ?, updated_at = ? WHERE talent_id = ?").run(primary.id, timestamp, secondary.id);
  db.prepare("UPDATE match_live_search SET talent_id = ? WHERE talent_id = ?").run(primary.id, secondary.id);
  rewriteMatchHistoryTalentReferences(secondary, patched, actor);

  const archiveNote = makeMiscNote({
    note: `Archived after duplicate merge into "${patched.name}" (#${patched.id}).`,
    source: "duplicate_merge",
    field: "merge_audit",
    added_by: actorLabelValue,
    date: timestamp,
    metadata: { primary_id: patched.id, secondary_id: secondary.id }
  });
  db.prepare(`
    UPDATE talents
    SET misc_notes_json = ?, archived_at = ?, updated_by_user_id = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(mergeMiscNotes(secondary.misc_notes, [archiveNote])), timestamp, actorUserId(actor), timestamp, secondary.id);
  removeTalentSearchIndex(secondary.id);

  return {
    primary: getTalent(patched.id, { includeArchived: true }),
    secondary: getTalent(secondary.id, { includeArchived: true }),
    merged: true
  };
}

function mergeConflictNotes(primary, secondary, addedBy, date) {
  const notes = [];
  for (const field of ["rate", "availability", "notes", "past_bookings", "wikidata_item_id"]) {
    const left = field === "tags" ? primary.tags.join(", ") : String(primary[field] || "").trim();
    const right = field === "tags" ? secondary.tags.join(", ") : String(secondary[field] || "").trim();
    if (!left || !right || normalizeComparable(left) === normalizeComparable(right)) continue;
    notes.push(makeMiscNote({
      note: `Duplicate merge preserved secondary ${fieldLabel(field)}: ${right}`,
      source: "duplicate_merge",
      field,
      added_by: addedBy,
      date,
      metadata: { primary_value: left }
    }));
  }
  return notes.filter(Boolean);
}

function mergeLongText(primaryText, secondaryText, heading) {
  const left = String(primaryText || "").trim();
  const right = String(secondaryText || "").trim();
  if (!left) return right;
  if (!right || normalizeComparable(left).includes(normalizeComparable(right))) return left;
  return `${left}\n\n${heading}: ${right}`;
}

function mergePublicSources(...groups) {
  const seen = new Set();
  const merged = [];
  for (const source of groups.flatMap((group) => normalizePublicSources(group))) {
    const key = String(source.item_id || source.url || source.label || JSON.stringify(source)).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(source);
  }
  return merged.slice(0, 20);
}

function rewriteMatchHistoryTalentReferences(secondary, primary, actor = null) {
  const rows = db.prepare("SELECT * FROM match_history ORDER BY id").all()
    .filter((row) => matchHistoryReferencesTalent(row, secondary.id));
  const timestamp = now();
  const update = db.prepare(`
    UPDATE match_history
    SET result_json = ?, roster_snapshot_json = ?, updated_by_user_id = ?, updated_at = ?
    WHERE id = ?
  `);
  for (const row of rows) {
    const result = rewriteResultTalentReferences(asJson(row.result_json, {}), secondary, primary);
    const snapshot = rewriteRosterSnapshotReferences(asJson(row.roster_snapshot_json, []), secondary, primary);
    update.run(JSON.stringify(result), JSON.stringify(snapshot), actorUserId(actor), timestamp, row.id);
  }
}

function matchHistoryReferencesTalent(row, talentId) {
  const id = Number(talentId);
  const result = asJson(row.result_json, {});
  const snapshot = asJson(row.roster_snapshot_json, []);
  return [...(result.shortlist || []), ...(result.excluded_but_close || [])].some((item) => Number(item?.talent_id) === id)
    || (Array.isArray(snapshot) && snapshot.some((item) => Number(item?.id) === id));
}

function rewriteResultTalentReferences(result, secondary, primary) {
  const replaceItem = (item) => {
    if (!item || Number(item.talent_id) !== Number(secondary.id)) return item;
    return {
      ...item,
      talent_id: primary.id,
      name: primary.name,
      cautions: uniqueStrings([...(item.cautions || []), `Originally referenced merged duplicate ${secondary.name} (#${secondary.id}).`])
    };
  };
  return {
    ...result,
    shortlist: (result.shortlist || []).map(replaceItem),
    excluded_but_close: (result.excluded_but_close || []).map(replaceItem)
  };
}

function rewriteRosterSnapshotReferences(snapshot, secondary, primary) {
  if (!Array.isArray(snapshot)) return snapshot;
  return snapshot.map((item) => Number(item?.id) === Number(secondary.id)
    ? { ...item, id: primary.id, name: primary.name, merged_from_talent_id: secondary.id, merged_from_name: secondary.name }
    : item);
}

function talentEntityIds(talent) {
  const ids = new Set();
  for (const value of [
    talent.wikidata_item_id,
    talent.wikidataItemId,
    ...(talent.public_sources || []).map((source) => source?.item_id || source?.id || source?.url)
  ]) {
    const match = String(value || "").toUpperCase().match(/Q\d+/);
    if (match) ids.add(match[0]);
  }
  return ids;
}

export function createTalent(input, source = "user", actor = null) {
  const talent = normalizeTalentInput(input);
  if (!talent.name) throw new Error("Talent name is required.");
  talent.wikidata_summary = wikidataSummaryForSources(talent.public_sources, talent.wikidata_summary);
  const nowValue = now();
  const userId = actorUserId(actor);
  const fieldUpdatedAt = Object.fromEntries(TALENT_FIELDS.map((field) => [field, nowValue]));
  const fieldSource = Object.fromEntries(TALENT_FIELDS.map((field) => [field, source]));
  const result = db.prepare(`
    INSERT INTO talents
      (name, tags_json, rate, notes, misc_notes_json, availability, past_bookings, photo_path,
       wikidata_item_id, wikidata_summary, public_sources_json, field_updated_at_json, field_source_json,
       created_by_user_id, updated_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    talent.name,
    JSON.stringify(talent.tags),
    talent.rate,
    talent.notes,
    JSON.stringify(talent.misc_notes),
    talent.availability,
    talent.past_bookings,
    talent.photo_path,
    talent.wikidata_item_id,
    talent.wikidata_summary,
    JSON.stringify(talent.public_sources),
    JSON.stringify(fieldUpdatedAt),
    JSON.stringify(fieldSource),
    userId,
    userId,
    nowValue,
    nowValue
  );
  let created = getTalent(Number(result.lastInsertRowid));
  if (created.rate) {
    recordRateHistory(created.id, "", created.rate, source, actorLabel(actor));
    created = getTalent(created.id);
  }
  updateTalentSearchIndex(created);
  if (shouldSuggestProfileTags(source)) maybeCreateTagSuggestions(created, source);
  return { talent: created, action: "created", source };
}

export function patchTalent(identifier, input, source = "user", actor = null) {
  const existing = getTalent(identifier, { includeArchived: true });
  if (!existing) throw new Error("Talent not found.");
  const normalized = normalizeTalentInput({ ...existing, ...input });
  normalized.wikidata_summary = wikidataSummaryForSources(normalized.public_sources, normalized.wikidata_summary);
  if (!normalized.name) throw new Error("Talent name is required.");

  const timestamp = now();
  const userId = actorUserId(actor);
  const updates = {};
  const sourceUpdates = {};
  for (const field of TALENT_FIELDS) {
    const nextValue = field === "tags" ? normalized.tags : normalized[field];
    const currentValue = field === "tags" ? existing.tags : existing[field];
    if (JSON.stringify(nextValue) !== JSON.stringify(currentValue)) {
      updates[field] = timestamp;
      sourceUpdates[field] = source;
    }
  }

  const fieldUpdatedAt = { ...existing.field_updated_at, ...updates };
  const fieldSource = { ...normalizeFieldSource(existing.field_source, "legacy"), ...sourceUpdates };
  db.prepare(`
    UPDATE talents
    SET name = ?, tags_json = ?, rate = ?, notes = ?, misc_notes_json = ?, availability = ?, past_bookings = ?, photo_path = ?,
        wikidata_item_id = ?, wikidata_summary = ?, public_sources_json = ?,
        field_updated_at_json = ?, field_source_json = ?, updated_by_user_id = ?, updated_at = ?
    WHERE id = ?
  `).run(
    normalized.name,
    JSON.stringify(normalized.tags),
    normalized.rate,
    normalized.notes,
    JSON.stringify(normalized.misc_notes),
    normalized.availability,
    normalized.past_bookings,
    normalized.photo_path,
    normalized.wikidata_item_id,
    normalized.wikidata_summary,
    JSON.stringify(normalized.public_sources),
    JSON.stringify(fieldUpdatedAt),
    JSON.stringify(fieldSource),
    userId,
    timestamp,
    existing.id
  );
  if (Object.prototype.hasOwnProperty.call(updates, "rate")) {
    recordRateHistory(existing.id, existing.rate, normalized.rate, source, actorLabel(actor));
  }
  const talent = getTalent(existing.id, { includeArchived: true });
  updateTalentSearchIndex(talent);
  if (shouldSuggestProfileTags(source) && Object.keys(updates).some((field) => ["notes", "past_bookings", "misc_notes"].includes(field))) {
    maybeCreateTagSuggestions(talent, source);
  }
  return { talent, action: Object.keys(updates).length ? "updated" : "unchanged", source };
}

export function addTalentMiscNote(identifier, input = {}, addedBy = "") {
  const existing = getTalent(identifier);
  if (!existing) throw new Error("Talent not found.");
  const blocked = detectSensitiveProfileText(input.note);
  if (blocked.length) {
    throw new Error(`Profile note blocked by sensitive-field policy: ${blocked.join(", ")}.`);
  }
  const note = makeMiscNote({
    note: input.note,
    source: input.source || "manual",
    match_id: input.match_id || input.matchId || null,
    import_batch_id: input.import_batch_id || input.importBatchId || null,
    field: input.field || "",
    added_by: addedBy || input.added_by || input.addedBy || "",
    metadata: input.metadata || {}
  });
  if (!note) throw new Error("Note text is required.");
  return patchTalent(existing.id, {
    misc_notes: mergeMiscNotes(existing.misc_notes, [note])
  }, note.source);
}

export function upsertTalent(input, source = "user", actor = null) {
  const normalized = normalizeTalentInput(input);
  if (!normalized.name) throw new Error("Talent name is required.");
  const existing = getTalent(normalized.name, { includeArchived: true });
  if (!existing) return createTalent(normalized, source, actor);
  const patch = {};
  for (const field of TALENT_FIELDS) {
    if (field === "name") continue;
    if (field === "tags") {
      if (normalized.tags.length) patch.tags = normalized.tags;
    } else if (field === "misc_notes") {
      if (normalized.misc_notes.length) patch.misc_notes = mergeMiscNotes(existing.misc_notes, normalized.misc_notes);
    } else if (field === "public_sources") {
      if (normalized.public_sources.length) patch.public_sources = normalized.public_sources;
    } else if (normalized[field]) {
      patch[field] = normalized[field];
    }
  }
  return patchTalent(existing.id, patch, source, actor);
}

export function archiveTalent(identifier, actor = null) {
  const existing = getTalent(identifier, { includeArchived: true });
  if (!existing) throw new Error("Talent not found.");
  if (existing.archived_at) return existing;
  const timestamp = now();
  db.prepare("UPDATE talents SET archived_at = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ?")
    .run(timestamp, actorUserId(actor), timestamp, existing.id);
  removeTalentSearchIndex(existing.id);
  return getTalent(existing.id, { includeArchived: true });
}

export function restoreTalent(identifier, actor = null) {
  const existing = getTalent(identifier, { includeArchived: true });
  if (!existing) throw new Error("Talent not found.");
  const timestamp = now();
  db.prepare("UPDATE talents SET archived_at = '', updated_by_user_id = ?, updated_at = ? WHERE id = ?")
    .run(actorUserId(actor), timestamp, existing.id);
  const restored = getTalent(existing.id, { includeArchived: true });
  updateTalentSearchIndex(restored);
  return restored;
}

export function deleteTalent(identifier) {
  const existing = getTalent(identifier, { includeArchived: true });
  if (!existing) throw new Error("Talent not found.");
  removeTalentSearchIndex(existing.id);
  db.prepare("DELETE FROM talents WHERE id = ?").run(existing.id);
  removeStoredPhoto(existing.photo_path);
  return existing;
}

export function saveTalentPhotoDataUrl(identifier, dataUrl, actor = null) {
  const existing = getTalent(identifier, { includeArchived: true });
  if (!existing) throw new Error("Talent not found.");
  const parsed = parsePhotoDataUrl(dataUrl);
  const filename = `${existing.id}-${crypto.randomBytes(8).toString("hex")}.${parsed.extension}`;
  const absolutePath = resolve(UPLOADS_DIR, filename);
  if (!absolutePath.startsWith(UPLOADS_DIR)) throw new Error("Invalid upload path.");
  writeFileSync(absolutePath, parsed.buffer);
  removeStoredPhoto(existing.photo_path);
  return patchTalent(existing.id, { photo_path: `uploads/${filename}` }, "photo", actor).talent;
}

export function clearTalentPhoto(identifier, actor = null) {
  const existing = getTalent(identifier, { includeArchived: true });
  if (!existing) throw new Error("Talent not found.");
  removeStoredPhoto(existing.photo_path);
  return patchTalent(existing.id, { photo_path: "" }, "photo", actor).talent;
}

function parsePhotoDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error("Photo must be a PNG, JPEG, WebP, or GIF image.");
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 5_000_000) throw new Error("Photo must be under 5 MB.");
  const extension = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : mimeType.includes("gif")
        ? "gif"
        : "jpg";
  return { buffer, extension };
}

function removeStoredPhoto(photoPath) {
  if (!photoPath) return;
  const absolutePath = resolve(APP_ROOT, photoPath);
  if (!absolutePath.startsWith(UPLOADS_DIR) || !existsSync(absolutePath)) return;
  unlinkSync(absolutePath);
}

function sourceSnapshotForTalent(talent) {
  const fields = {};
  for (const field of PUBLIC_ROSTER_FIELDS) {
    if (field === "public_sources") {
      fields[field] = {
        value: summarizePublicSources(talent.public_sources),
        updated_at: talent.field_updated_at[field] || talent.updated_at,
        source: talent.field_source[field] || "unknown",
        sources: talent.public_sources
      };
      continue;
    }
    if (field === "misc_notes") {
      fields[field] = {
        value: summarizeMiscNotes(talent.misc_notes),
        updated_at: talent.field_updated_at[field] || talent.updated_at,
        source: talent.field_source[field] || "unknown",
        notes: talent.misc_notes
      };
      continue;
    }
    fields[field] = {
      value: field === "tags" ? talent.tags.join(", ") : talent[field],
      updated_at: talent.field_updated_at[field] || talent.updated_at,
      source: talent.field_source[field] || "unknown"
    };
  }
  return { id: talent.id, name: talent.name, fields };
}

function matchHistoryFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    brief: row.brief,
    criteria: asJson(row.criteria_json, {}),
    requirements: asJson(row.requirements_json, {}),
    result: asJson(row.result_json, {}),
    roster_snapshot: asJson(row.roster_snapshot_json, []),
    enrich_web: Boolean(row.enrich_web),
    model_source: row.model_source,
    model_name: row.model_name,
    outcome: row.outcome,
    feedback: row.feedback,
    created_by_user_id: row.created_by_user_id || null,
    updated_by_user_id: row.updated_by_user_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function recentMatchHistory(limit = 8) {
  return db.prepare("SELECT * FROM match_history ORDER BY created_at DESC LIMIT ?").all(limit).map(matchHistoryFromRow);
}

export function getMatchHistoryEntry(identifier) {
  return matchHistoryFromRow(db.prepare("SELECT * FROM match_history WHERE id = ?").get(Number(identifier)));
}

export function listLiveSearchFindings(matchHistoryId) {
  return db.prepare(`
    SELECT * FROM match_live_search
    WHERE match_history_id = ?
    ORDER BY fetched_at DESC, id DESC
  `).all(Number(matchHistoryId)).map(liveSearchFromRow);
}

export function formatClientShortlistExport(identifier) {
  const entry = typeof identifier === "object" ? identifier : getMatchHistoryEntry(identifier);
  if (!entry) throw new Error("Match history entry not found.");
  const result = entry.result || {};
  const shortlist = result.shortlist || [];
  const lines = [
    "Draft talent shortlist",
    `Client request: ${entry.brief}`,
    ""
  ];

  if (!shortlist.length) {
    lines.push("No shortlist is ready yet.");
  }

  shortlist.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.name}${item.fit ? ` (${item.fit} fit)` : ""}`);
    if (item.rationale) lines.push(`Why: ${singleLine(item.rationale)}`);
    const clientSources = (item.claims || []).slice(0, 3).map(clientSourceLine).filter(Boolean);
    for (const source of clientSources) lines.push(`Source: ${source}`);
    lines.push("");
  });

  lines.push("Review before sending to the client.");
  lines.push("Requires review before external use.");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function clientSourceLine(claim = {}) {
  const source = claim.source || {};
  const claimText = singleLine(claim.claim || "");
  if (source.type === "external") {
    return [claimText, source.title || "public source", source.url].filter(Boolean).join(" - ");
  }
  return [claimText, source.field ? `roster ${fieldLabel(source.field)}` : "roster record"].filter(Boolean).join(" - ");
}

function singleLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function storeMatchHistory({ brief, result, requirements, rosterSnapshot, enrichWeb, modelSource, modelName, actor }) {
  const nowValue = now();
  const userId = actorUserId(actor);
  const insert = db.prepare(`
    INSERT INTO match_history
      (brief, criteria_json, requirements_json, result_json, roster_snapshot_json, enrich_web, model_source, model_name, created_by_user_id, updated_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    brief,
    JSON.stringify(result.criteria || {}),
    JSON.stringify(requirements || result.requirements || {}),
    JSON.stringify(result),
    JSON.stringify(rosterSnapshot),
    enrichWeb ? 1 : 0,
    modelSource,
    modelName,
    userId,
    userId,
    nowValue,
    nowValue
  );
  return Number(insert.lastInsertRowid);
}

function updateStoredMatchResult(identifier, result, requirements, modelSource, modelName, actor = null) {
  const timestamp = now();
  db.prepare(`
    UPDATE match_history
    SET result_json = ?, requirements_json = ?, criteria_json = ?, model_source = ?, model_name = ?, updated_by_user_id = ?, updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(result),
    JSON.stringify(requirements || result.requirements || {}),
    JSON.stringify(result.criteria || {}),
    modelSource,
    modelName,
    actorUserId(actor),
    timestamp,
    Number(identifier)
  );
}

export function updateHistoryFeedback(identifier, input, actor = null) {
  const existing = db.prepare("SELECT * FROM match_history WHERE id = ?").get(Number(identifier));
  if (!existing) throw new Error("History entry not found.");
  const outcome = String(input.outcome || "").trim();
  const feedback = String(input.feedback || "").trim();
  const nowValue = now();
  db.prepare("UPDATE match_history SET outcome = ?, feedback = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ?")
    .run(outcome, feedback, actorUserId(actor), nowValue, existing.id);
  const updated = recentMatchHistory(100).find((entry) => entry.id === existing.id);
  createMatchFeedbackSuggestions(updated);
  return updated;
}

export function listInquiryTemplates() {
  return db.prepare(`
    SELECT id, title, brief, created_at, updated_at
    FROM inquiry_templates
    ORDER BY title COLLATE NOCASE ASC
  `).all();
}

export function createInquiryTemplate(input = {}, actor = null) {
  const title = String(input.title || "").trim();
  const brief = String(input.brief || "").trim();
  if (!title) throw new Error("Template title is required.");
  if (!brief) throw new Error("Template brief is required.");
  const timestamp = now();
  const userId = actorUserId(actor);
  const existing = db.prepare("SELECT * FROM inquiry_templates WHERE title = ? COLLATE NOCASE").get(title);
  if (existing) {
    db.prepare("UPDATE inquiry_templates SET brief = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ?")
      .run(brief, userId, timestamp, existing.id);
    return db.prepare("SELECT * FROM inquiry_templates WHERE id = ?").get(existing.id);
  }
  const insert = db.prepare(`
    INSERT INTO inquiry_templates (title, brief, created_by_user_id, updated_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title, brief, userId, userId, timestamp, timestamp);
  return db.prepare("SELECT * FROM inquiry_templates WHERE id = ?").get(Number(insert.lastInsertRowid));
}

export function deleteInquiryTemplate(identifier) {
  const result = db.prepare("DELETE FROM inquiry_templates WHERE id = ?").run(Number(identifier));
  return { id: Number(identifier), deleted: result.changes > 0 };
}

export function listSuggestions(status = "open") {
  generateStalenessSuggestions();
  const rows = db.prepare(`
    SELECT suggestions.*, talents.name AS talent_name
    FROM suggestions
    LEFT JOIN talents ON talents.id = suggestions.talent_id
    WHERE suggestions.status = ?
    ORDER BY suggestions.created_at DESC, suggestions.id DESC
  `).all(status || "open");
  return rows.map(suggestionFromRow);
}

export async function resolveSuggestion(identifier, input = {}, resolvedBy = "") {
  const row = db.prepare("SELECT * FROM suggestions WHERE id = ?").get(Number(identifier));
  if (!row) throw new Error("Suggestion not found.");
  const suggestion = suggestionFromRow(row);
  if (suggestion.status !== "open") return suggestion;
  const payload = suggestion.payload || {};
  const action = String(input.action || payload.default_action || "dismiss");
  let resolution = action;

  if (action === "apply_tags") {
    applySuggestedTags(suggestion, resolvedBy);
  } else if (action === "apply_note") {
    const noteText = payload.note || suggestion.body;
    const blocked = detectSensitiveProfileText(noteText);
    if (blocked.length) {
      resolution = `sensitive_blocked:${blocked.join(",")}`;
    } else {
      addTalentMiscNote(suggestion.talent_id, {
        note: noteText,
        source: payload.note_source || suggestion.source || suggestion.type,
        match_id: suggestion.match_id,
        import_batch_id: suggestion.import_batch_id,
        metadata: payload.metadata || {}
      }, resolvedBy);
    }
  } else if (action === "confirm_current") {
    touchTalentField(suggestion.talent_id, payload.field, "review_confirmed", resolvedBy);
  } else if (action === "mark_wikidata_reviewed") {
    touchTalentField(suggestion.talent_id, "public_sources", "wikidata_reviewed", resolvedBy);
  } else if (action === "refresh_wikidata") {
    const refresh = await proposeWikidataRefresh(suggestion.talent_id, resolvedBy);
    resolution = refresh ? "refresh_review_created" : "refresh_no_changes";
  } else if (action === "apply_wikidata_refresh") {
    applyWikidataRefreshSuggestion(suggestion, resolvedBy);
  } else if (action === "merge_duplicate") {
    const primaryId = Number(input.primary_id || input.primaryId || payload.primary_id || payload.talent_id_a);
    const secondaryId = Number(input.secondary_id || input.secondaryId || payload.secondary_id || (primaryId === Number(payload.talent_id_a) ? payload.talent_id_b : payload.talent_id_a));
    mergeDuplicateTalents(primaryId, secondaryId, resolvedBy);
  } else {
    resolution = "dismiss";
  }

  const status = resolution === "dismiss" ? "dismissed" : "resolved";
  const timestamp = now();
  db.prepare(`
    UPDATE suggestions
    SET status = ?, resolved_at = ?, resolved_by = ?, resolution = ?, updated_at = ?
    WHERE id = ?
  `).run(status, timestamp, resolvedBy, resolution, timestamp, suggestion.id);
  return suggestionFromRow(db.prepare(`
    SELECT suggestions.*, talents.name AS talent_name
    FROM suggestions
    LEFT JOIN talents ON talents.id = suggestions.talent_id
    WHERE suggestions.id = ?
  `).get(suggestion.id));
}

function createSuggestion(input = {}) {
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const hash = suggestionHash({
    type: input.type,
    talent_id: input.talent_id || null,
    match_id: input.match_id || null,
    import_batch_id: input.import_batch_id || null,
    payload
  });
  const existing = db.prepare("SELECT * FROM suggestions WHERE content_hash = ?").get(hash);
  if (existing) return suggestionFromRow(existing);
  const timestamp = now();
  const insert = db.prepare(`
    INSERT INTO suggestions
      (type, status, talent_id, match_id, import_batch_id, title, body, payload_json, source, confidence, content_hash, created_at, updated_at)
    VALUES (?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(input.type || "general"),
    input.talent_id || null,
    input.match_id || null,
    input.import_batch_id || null,
    String(input.title || "Review suggestion"),
    String(input.body || ""),
    JSON.stringify(payload),
    String(input.source || input.type || ""),
    Number(input.confidence || 0),
    hash,
    timestamp,
    timestamp
  );
  return suggestionFromRow(db.prepare("SELECT * FROM suggestions WHERE id = ?").get(Number(insert.lastInsertRowid)));
}

function suggestionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    talent_id: row.talent_id,
    talent_name: row.talent_name || "",
    match_id: row.match_id,
    import_batch_id: row.import_batch_id,
    title: row.title,
    body: row.body,
    payload: asJson(row.payload_json, {}),
    source: row.source,
    confidence: row.confidence,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by,
    resolution: row.resolution
  };
}

function suggestionHash(value) {
  return crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

function applySuggestedTags(suggestion, actor = null) {
  const talent = getTalent(suggestion.talent_id);
  if (!talent) throw new Error("Talent not found for suggestion.");
  const tags = normalizeTags(suggestion.payload?.tags || []);
  const merged = dedupeLabels([...talent.tags, ...tags]);
  if (merged.length === talent.tags.length) return talent;
  return patchTalent(talent.id, { tags: merged }, "suggestion", actor).talent;
}

function touchTalentField(identifier, field, source = "review_confirmed", actor = null) {
  const talent = getTalent(identifier);
  if (!talent) throw new Error("Talent not found.");
  if (!TALENT_FIELDS.includes(field)) throw new Error("Unsupported field for review confirmation.");
  const timestamp = now();
  const fieldUpdatedAt = { ...talent.field_updated_at, [field]: timestamp };
  const fieldSource = { ...normalizeFieldSource(talent.field_source, "legacy"), [field]: source };
  db.prepare("UPDATE talents SET field_updated_at_json = ?, field_source_json = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(fieldUpdatedAt), JSON.stringify(fieldSource), actorUserId(actor), timestamp, talent.id);
  return getTalent(talent.id, { includeArchived: true });
}

function maybeCreateTagSuggestions(talent, source = "user") {
  if (!talent) return [];
  const text = [
    talent.notes,
    talent.past_bookings,
    summarizeMiscNotes(talent.misc_notes)
  ].join("\n");
  const tags = dedupeLabels(keywordLabels(text)).filter((tag) => !talent.tags.includes(tag));
  if (!tags.length) return [];
  return [createSuggestion({
    type: "tag_suggestion",
    talent_id: talent.id,
    title: `Suggested tags for ${talent.name}`,
    body: `Profile text suggests ${tags.join(", ")}.`,
    payload: { default_action: "apply_tags", tags },
    source,
    confidence: 0.78
  })];
}

function shouldSuggestProfileTags(source) {
  return ["boss_entered", "user", "spreadsheet", "csv_import"].includes(String(source || ""));
}

function createMatchFeedbackSuggestions(entry) {
  if (!entry?.id) return [];
  const shortlist = entry.result?.shortlist || [];
  const created = [];
  if (entry.outcome === "approved") {
    for (const item of shortlist) {
      if (!item.talent_id || !item.rationale) continue;
      created.push(createSuggestion({
        type: "match_note",
        talent_id: item.talent_id,
        match_id: entry.id,
        title: `Save match insight for ${item.name}?`,
        body: item.rationale,
        payload: {
          default_action: "apply_note",
          note: item.rationale,
          note_source: "match_feedback",
          metadata: { fit: item.fit, score: item.score, score_drivers: item.score_drivers || [] }
        },
        source: "match_feedback",
        confidence: 0.72
      }));
      for (const finding of item.live_search_findings || []) {
        if (finding.confidence !== "supports") continue;
        const note = `Live search supported ${finding.requirement_key} for match #${entry.id}: ${finding.rationale}`;
        created.push(createSuggestion({
          type: "live_search_note",
          talent_id: item.talent_id,
          match_id: entry.id,
          title: `Save live-search finding for ${item.name}?`,
          body: note,
          payload: {
            default_action: "apply_note",
            note,
            note_source: "live_search",
            metadata: {
              requirement_key: finding.requirement_key,
              confidence: finding.confidence,
              fetched_at: finding.fetched_at,
              findings: finding.findings || []
            }
          },
          source: "live_search",
          confidence: 0.66
        }));
      }
    }
  }
  if (entry.outcome === "discarded" && entry.feedback) {
    for (const item of shortlist) {
      if (!item.talent_id) continue;
      const note = `Discarded match #${entry.id}: ${entry.feedback}`;
      created.push(createSuggestion({
        type: "discard_feedback_note",
        talent_id: item.talent_id,
        match_id: entry.id,
        title: `Save discard feedback for ${item.name}?`,
        body: entry.feedback,
        payload: {
          default_action: "apply_note",
          note,
          note_source: "match_feedback",
          metadata: { outcome: "discarded", score_drivers: item.score_drivers || [] }
        },
        source: "match_feedback",
        confidence: 0.8
      }));
    }
  }
  return created;
}

function createImportReviewSuggestions(batchId, analyses) {
  const created = [];
  for (const analysis of analyses) {
    if (!["conflict", "needs_review", "error"].includes(analysis.status)) continue;
    created.push(createSuggestion({
      type: "import_review",
      talent_id: analysis.entity_match?.id || null,
      import_batch_id: batchId,
      title: `Import row ${analysis.row_number} needs review`,
      body: `${analysis.record.name || "Unnamed row"}: ${analysis.issues[0] || analysis.diff?.conflicts?.[0]?.field || analysis.status}`,
      payload: {
        default_action: "dismiss",
        row_number: analysis.row_number,
        status: analysis.status,
        record: analysis.record,
        entity_match: analysis.entity_match,
        diff: analysis.diff,
        issues: analysis.issues
      },
      source: "csv_import",
      confidence: analysis.confidence
    }));
  }
  return created;
}

function generateStalenessSuggestions() {
  const staleMs = Number(process.env.STALENESS_DAYS || 60) * 24 * 60 * 60 * 1000;
  const wikidataStaleMs = Number(process.env.WIKIDATA_STALENESS_DAYS || 180) * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - staleMs;
  const wikidataCutoff = Date.now() - wikidataStaleMs;
  for (const talent of listTalents()) {
    const touched = Date.parse(talent.field_updated_at?.availability || talent.updated_at || talent.created_at);
    if (Number.isFinite(touched) && touched <= cutoff) {
      createSuggestion({
        type: "staleness_nudge",
        talent_id: talent.id,
        title: `Confirm availability for ${talent.name}`,
        body: `Availability has not been touched since ${shortIsoDate(talent.field_updated_at?.availability || talent.updated_at)}.`,
        payload: {
          default_action: "confirm_current",
          field: "availability",
          field_updated_at: talent.field_updated_at?.availability || talent.updated_at
        },
        source: "staleness",
        confidence: 0.7
      });
    }
    const hasWikidata = talent.wikidata_item_id || (talent.public_sources || []).some((source) => source.provider === "Wikidata" || source.type === "wikidata");
    const wikidataTouched = Date.parse(talent.field_updated_at?.public_sources || talent.updated_at || talent.created_at);
    if (hasWikidata && (!Number.isFinite(wikidataTouched) || wikidataTouched <= wikidataCutoff)) {
      createSuggestion({
        type: "wikidata_stale",
        talent_id: talent.id,
        title: `Review Wikidata source for ${talent.name}`,
        body: `Attached Wikidata enrichment has not been reviewed since ${shortIsoDate(talent.field_updated_at?.public_sources || talent.updated_at)}.`,
        payload: {
          default_action: "mark_wikidata_reviewed",
          secondary_action: "refresh_wikidata",
          field: "public_sources",
          wikidata_item_id: talent.wikidata_item_id || talent.public_sources?.find((source) => source.item_id)?.item_id || ""
        },
        source: "wikidata_staleness",
        confidence: 0.68
      });
    }
  }
}

function shortIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "an unknown date";
  return date.toISOString().slice(0, 10);
}

export function parseCsv(text, delimiter = ",") {
  return rowsToTalentRecords(parseDelimitedRows(text, delimiter));
}

function parseDelimitedRows(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseSpreadsheetContent({ filename = "upload.csv", text = "", base64 = "" }) {
  return rowsToTalentRecords(parseSpreadsheetRowsContent({ filename, text, base64 }));
}

export function parseSpreadsheetRowsContent({ filename = "upload.csv", text = "", base64 = "" }) {
  const extension = extname(filename).toLowerCase();
  if (extension === ".xlsx") {
    if (!base64) throw new Error("XLSX import requires base64 file content.");
    return parseXlsxRows(Buffer.from(base64, "base64"));
  }
  if (extension === ".xls") {
    throw new Error("Legacy .xls files are not supported yet. Please upload .xlsx, .csv, or .tsv.");
  }
  const csvText = text || Buffer.from(base64 || "", "base64").toString("utf8");
  return parseDelimitedRows(csvText, extension === ".tsv" ? "\t" : ",");
}

function parseXlsx(buffer) {
  return rowsToTalentRecords(parseXlsxRows(buffer));
}

function parseXlsxRows(buffer) {
  const files = unzipXlsx(buffer);
  const workbookXml = files.get("xl/workbook.xml")?.toString("utf8");
  const relsXml = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  if (!workbookXml || !relsXml) throw new Error("XLSX file is missing workbook metadata.");

  const firstSheet = [...workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)][0];
  if (!firstSheet) throw new Error("XLSX file does not contain a readable worksheet.");
  const relationshipId = firstSheet[2];
  const relMatch = new RegExp(`<Relationship\\b[^>]*Id="${escapeRegex(relationshipId)}"[^>]*Target="([^"]+)"`, "i").exec(relsXml);
  const sheetPath = relMatch ? normalizeXlsxPath(`xl/${relMatch[1]}`) : "xl/worksheets/sheet1.xml";
  const sheetXml = files.get(sheetPath)?.toString("utf8");
  if (!sheetXml) throw new Error("XLSX file is missing the first worksheet.");

  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8") || "");
  const rows = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowValues = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = (/r="([A-Z]+)\d+"/.exec(attrs) || [])[1];
      const columnIndex = ref ? columnNameToIndex(ref) : rowValues.length;
      rowValues[columnIndex] = readXlsxCell(attrs, body, sharedStrings);
    }
    if (rowValues.some((value) => String(value || "").trim())) rows.push(rowValues);
  }
  return rows;
}

function unzipXlsx(buffer) {
  const files = new Map();
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 66000); index -= 1) {
    if (buffer.readUInt32LE(index) === eocdSignature) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Invalid XLSX file.");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) throw new Error("Invalid XLSX central directory.");
    const compression = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const filenameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const filename = buffer.slice(centralOffset + 46, centralOffset + 46 + filenameLength).toString("utf8");

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Invalid XLSX local file header.");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    const data = compression === 0
      ? compressed
      : compression === 8
        ? zlib.inflateRawSync(compressed, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
        : null;
    if (!data) throw new Error(`Unsupported XLSX compression method: ${compression}`);
    if (uncompressedSize && data.length !== uncompressedSize) {
      throw new Error(`XLSX entry failed size check: ${filename}`);
    }
    files.set(normalizeXlsxPath(filename), data);
    centralOffset += 46 + filenameLength + extraLength + commentLength;
  }
  return files;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => decodeXml(
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")
  ));
}

function readXlsxCell(attrs, body, sharedStrings) {
  const type = (/t="([^"]+)"/.exec(attrs) || [])[1];
  if (type === "s") {
    const index = Number((/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1]);
    return sharedStrings[index] || "";
  }
  if (type === "inlineStr") {
    return decodeXml([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join(""));
  }
  return decodeXml((/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1] || "");
}

function rowsToTalentRecords(rows, mapping = null) {
  if (!rows.length) return [];
  const rawHeaders = rows[0].map((header) => String(header || "").trim());
  const headers = rawHeaders.map((header) => normalizeHeader(header));
  const columnMapping = normalizeColumnMapping(mapping || proposeColumnMapping(rawHeaders));
  return rows
    .slice(1)
    .filter((values) => values.some((value) => String(value || "").trim()))
    .map((values) => {
      const record = mapRawRowToRecord(headers, values, columnMapping);
      return spreadsheetRecordToTalent(record);
    });
}

function mapRawRowToRecord(headers, values, mapping) {
  const record = {};
  headers.forEach((header, index) => {
    const value = values[index] || "";
    if (!header || !String(value).trim()) return;
    const mapEntry = mapping[index] || {};
    const target = mapEntry.target || "label_source";
    if (target === "misc_notes" || target === "needs_mapping") {
      record[header] = appendImportValue(record[header], value);
      record.__misc_import_fields ||= [];
      record.__misc_import_fields.push({ header, value: String(value).trim() });
      return;
    }
    if (IMPORTABLE_FIELDS.includes(target)) {
      record[target] = appendImportValue(record[target], value);
      return;
    }
    if (target === "label_source") {
      record[header] = appendImportValue(record[header], value);
      return;
    }
    if (target === "ignore" || target === "sensitive_ignore") return;
    record[header] = appendImportValue(record[header], value);
  });
  return record;
}

function appendImportValue(existing, value) {
  const text = String(value || "").trim();
  if (!text) return existing || "";
  return existing ? `${existing}; ${text}` : text;
}

function proposeColumnMapping(rawHeaders) {
  return rawHeaders.map((header, index) => {
    const classification = classifyImportHeader(header);
    return {
      index,
      header: String(header || ""),
      normalized_header: normalizeHeader(header),
      target: classification.target,
      suggested_target: classification.suggested_target || classification.target,
      confidence: classification.confidence,
      reason: classification.reason
    };
  });
}

function normalizeColumnMapping(mapping) {
  return (mapping || []).map((entry, index) => {
    const normalizedHeader = entry.normalized_header || normalizeHeader(entry.header || "");
    const denied = FIELD_POLICY.denied.includes(normalizedHeader);
    return {
      index: Number.isInteger(entry.index) ? entry.index : index,
      header: entry.header || "",
      normalized_header: normalizedHeader,
      target: denied ? "sensitive_ignore" : sanitizeImportTarget(entry.target || entry.suggested_target || "ignore"),
      suggested_target: denied ? "sensitive_ignore" : sanitizeImportTarget(entry.suggested_target || entry.target || "ignore"),
      confidence: Number(entry.confidence || 0),
      reason: denied ? "Sensitive/protected field is not imported as a matching label." : entry.reason || ""
    };
  });
}

function sanitizeImportTarget(target) {
  const value = String(target || "ignore");
  if ([...IMPORTABLE_FIELDS, "label_source", "needs_mapping", "sensitive_ignore", "ignore"].includes(value)) return value;
  return "ignore";
}

function spreadsheetRecordToTalent(record) {
  const name = firstValue(record, [
    "name", "talent", "talent_name", "celebrity", "celebrity_name", "full_name",
    "artist", "artist_name", "person", "public_figure", "client_name"
  ]);
  const explicitTags = firstValue(record, [
    "tags", "tag", "labels", "label", "attributes", "attribute", "categories",
    "category", "genres", "genre", "vertical", "verticals", "niche", "niches"
  ]);
  const inferredLabels = extractCelebrityLabels(record);
  const notes = buildImportedNotes(record);
  const miscNotes = buildImportedMiscNotes(record);

  return {
    name,
    tags: mergeLabels(explicitTags, inferredLabels),
    rate: firstValue(record, ["rate", "fee", "price", "talent_rate", "booking_rate", "day_rate", "cost"]),
    notes,
    misc_notes: miscNotes,
    availability: firstValue(record, ["availability", "available", "status", "booking_status", "hold_status"]),
    past_bookings: firstValue(record, ["past_bookings", "past", "bookings", "past_work", "credits", "known_for", "campaigns", "notable_work"]),
    photo_path: firstValue(record, ["photo_path", "photo", "image", "image_path", "headshot", "headshot_url"]),
    wikidata_item_id: firstValue(record, ["wikidata_item_id", "wikidata", "wikidata_id", "qid", "q_id"])
  };
}

function firstValue(record, keys) {
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    const value = record[normalized];
    if (value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

const FIELD_POLICY = {
  schema: {
    name: ["name", "talent", "talent_name", "celebrity", "celebrity_name", "full_name", "artist", "artist_name", "person", "public_figure", "client_name"],
    tags: ["tags", "tag", "labels", "label", "attributes", "attribute", "categories", "category", "genres", "genre", "vertical", "verticals", "niche", "niches"],
    rate: ["rate", "fee", "price", "talent_rate", "booking_rate", "day_rate", "dayrate", "cost", "budget", "quote"],
    notes: ["notes", "note", "bio", "biography", "description", "summary", "profile", "overview"],
    misc_notes: ["misc", "misc_notes", "miscellaneous", "other", "other_notes", "additional_notes", "extra_notes"],
    availability: ["availability", "available", "status", "booking_status", "hold_status", "open_dates", "date_availability"],
    past_bookings: ["past_bookings", "past", "bookings", "past_work", "credits", "known_for", "campaigns", "notable_work", "previous_clients"],
    photo_path: ["photo_path", "photo", "image", "image_path", "headshot", "headshot_url", "picture"],
    wikidata_item_id: ["wikidata_item_id", "wikidata", "wikidata_id", "qid", "q_id"]
  },
  labelSource: [
    "profession", "professions", "occupation", "occupations", "role", "roles",
    "industry", "industries", "platform", "platforms", "audience", "audience_type",
    "audience_demo", "audience_demographic", "market", "markets", "location",
    "locations", "city", "country", "language", "languages", "skills", "skill",
    "specialty", "specialties", "brand_fit", "brand_affinity", "brand_categories",
    "style", "aesthetic", "look", "content_type", "content_category", "persona",
    "voice", "tone", "instagram", "tiktok", "tik_tok", "youtube", "twitter",
    "x_handle", "social", "handle", "followers", "subscribers", "audience_size", "reach"
  ].map(normalizeHeader),
  denied: [
    "race", "ethnicity", "religion", "politics", "political_party", "sexuality",
    "sexual_orientation", "health", "medical", "diagnosis", "disability", "age",
    "birth_date", "birthday", "gender", "sex", "marital_status", "children",
    "family_details", "address", "phone", "email", "ssn", "passport", "home_address"
  ].map(normalizeHeader)
};

const FIELD_ALIAS_LOOKUP = new Map(Object.entries(FIELD_POLICY.schema).flatMap(([field, aliases]) => (
  aliases.map((alias) => [normalizeHeader(alias), field])
)));

const SENSITIVE_TEXT_PATTERNS = [
  { category: "race/ethnicity", pattern: /\b(race|racial|ethnicity|ethnic|asian|black|white|latino|latina|hispanic|middle eastern|indigenous|native american|pacific islander)\b/i },
  { category: "religion", pattern: /\b(religion|religious|christian|muslim|islam|jewish|judaism|hindu|buddhist|catholic|protestant|mormon|sikh)\b/i },
  { category: "politics", pattern: /\b(politic|political|republican|democrat|conservative|liberal|socialist|campaign donor|voted for)\b/i },
  { category: "sexuality", pattern: /\b(sexuality|sexual orientation|gay|lesbian|bisexual|queer|lgbt|lgbtq)\b/i },
  { category: "health/disability", pattern: /\b(health condition|medical condition|diagnosis|diagnosed|disability|disabled|autistic|adhd|anxiety|depression|diabetes|cancer|chronic illness|pregnant|pregnancy)\b/i },
  { category: "age", pattern: /\b(age|birth date|birthday|born on|years old|yo)\b/i },
  { category: "gender/sex", pattern: /\b(gender|sex assigned|male|female|nonbinary|transgender|cisgender)\b/i },
  { category: "marital/family details", pattern: /\b(marital status|married|divorced|widowed|single parent|has children|has kids|no children)\b/i },
  { category: "private contact", pattern: /\b(home address|personal address|phone number|cell phone|email address|ssn|passport)\b/i }
];

function sanitizeProfileFreeText(value, field = "notes") {
  const text = String(value || "").trim();
  if (!text) return "";
  const denied = detectSensitiveProfileText(text);
  if (!denied.length) return text;
  return "";
}

function detectSensitiveProfileText(value) {
  const text = String(value || "");
  return SENSITIVE_TEXT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ category }) => category);
}

function policyCheckClientBrief(brief) {
  const text = String(brief || "");
  const blocked = SENSITIVE_TEXT_PATTERNS
    .map(({ category, pattern }) => {
      const match = pattern.exec(text);
      return match ? { category, term: match[0] } : null;
    })
    .filter(Boolean);
  if (!blocked.length) {
    return {
      original: text,
      matchable: text,
      blocked: [],
      flags: []
    };
  }
  let redacted = text;
  for (const { pattern } of SENSITIVE_TEXT_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    redacted = redacted.replace(new RegExp(pattern.source, flags), " ");
  }
  const categories = [...new Set(blocked.map((entry) => entry.category))];
  return {
    original: text,
    matchable: redacted.replace(/\s+/g, " ").trim(),
    blocked,
    flags: [`Client brief included protected/private criteria that were ignored for matching: ${categories.join(", ")}.`]
  };
}

function matchableHistory(history = []) {
  return (history || []).map((entry) => {
    const policy = policyCheckClientBrief(entry.brief);
    return {
      ...entry,
      original_brief: entry.brief,
      brief: policy.matchable,
      policy_flags: policy.flags
    };
  });
}

export function classifyImportHeader(header) {
  const normalized = normalizeHeader(header);
  if (!normalized) return { target: "ignore", confidence: 0, reason: "Blank header." };
  if (FIELD_POLICY.denied.includes(normalized)) {
    return { target: "sensitive_ignore", confidence: 1, reason: "Sensitive/protected field is not imported as a matching label." };
  }
  const exactField = FIELD_ALIAS_LOOKUP.get(normalized);
  if (exactField) {
    return { target: exactField, confidence: 1, reason: `Exact alias for ${exactField.replaceAll("_", " ")}.` };
  }
  if (FIELD_POLICY.labelSource.includes(normalized) || isSocialHeader(normalized) || isFollowerHeader(normalized)) {
    return { target: "label_source", confidence: 0.9, reason: "Useful for celebrity labels, not a primary roster field." };
  }

  let best = { field: "ignore", score: 0 };
  for (const [field, aliases] of Object.entries(FIELD_POLICY.schema)) {
    for (const alias of aliases) {
      const score = headerSimilarity(normalized, normalizeHeader(alias));
      if (score > best.score) best = { field, score };
    }
  }
  if (best.score >= 0.78) {
    return { target: best.field, confidence: roundConfidence(best.score), reason: `Fuzzy match to ${best.field.replaceAll("_", " ")}.` };
  }
  if (best.score >= 0.58) {
    return { target: "needs_mapping", suggested_target: best.field, confidence: roundConfidence(best.score), reason: `Possible ${best.field.replaceAll("_", " ")} column; needs review.` };
  }
  return { target: "misc_notes", confidence: 0.65, reason: "Unrecognized column; preserved as a misc profile note and scanned for safe labels." };
}

function headerSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.86;
  const leftTokens = new Set(left.split("_").filter(Boolean));
  const rightTokens = new Set(right.split("_").filter(Boolean));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenScore = overlap / Math.max(leftTokens.size, rightTokens.size, 1);
  return Math.max(tokenScore, stringSimilarity(left, right));
}

function stringSimilarity(left, right) {
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let last = i - 1;
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const old = previous[j];
      previous[j] = left[i - 1] === right[j - 1]
        ? last
        : Math.min(last + 1, previous[j] + 1, previous[j - 1] + 1);
      last = old;
    }
  }
  return previous[right.length];
}

function roundConfidence(value) {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

const CORE_IMPORT_HEADERS = new Set([
  "name", "talent", "talent_name", "celebrity", "celebrity_name", "full_name",
  "artist", "artist_name", "person", "public_figure", "client_name", "tags",
  "tag", "labels", "label", "attributes", "attribute", "categories", "category",
  "genres", "genre", "vertical", "verticals", "niche", "niches", "rate", "fee",
  "price", "talent_rate", "booking_rate", "day_rate", "cost", "notes", "note",
  "bio", "biography", "description", "summary", "misc", "misc_notes", "miscellaneous",
  "other", "other_notes", "additional_notes", "extra_notes", "availability", "available",
  "status", "booking_status", "hold_status", "past_bookings", "past", "bookings",
  "past_work", "credits", "known_for", "campaigns", "notable_work", "photo_path",
  "photo", "image", "image_path", "headshot", "headshot_url", "wikidata_item_id",
  "wikidata", "wikidata_id", "qid", "q_id"
]);

const DIRECT_LABEL_HEADERS = FIELD_POLICY.labelSource;
const SENSITIVE_LABEL_HEADERS = new Set(FIELD_POLICY.denied);

const KEYWORD_LABELS = [
  ["eyewear", /\b(eyewear|glasses|optical|optometry|frames)\b/i],
  ["spokesperson", /\b(spokesperson|host|presenter|on-camera|broadcast|teleprompter)\b/i],
  ["fitness", /\b(fitness|workout|training|athlete|wellness)\b/i],
  ["beauty", /\b(beauty|makeup|skincare|cosmetic)\b/i],
  ["fashion", /\b(fashion|style|runway|editorial|apparel)\b/i],
  ["luxury", /\b(luxury|premium|high-end|designer)\b/i],
  ["family-friendly", /\b(family-friendly|parents|parenting|kids|children's brand)\b/i],
  ["comedy", /\b(comedy|comedian|comic|humor|humour)\b/i],
  ["sports", /\b(sports|athlete|basketball|football|soccer|tennis|baseball|olympic)\b/i],
  ["music", /\b(music|musician|singer|rapper|songwriter|composer|album)\b/i],
  ["food", /\b(food|chef|restaurant|cooking|culinary)\b/i],
  ["travel", /\b(travel|hotel|tourism|destination)\b/i],
  ["gaming", /\b(gaming|gamer|esports|streamer)\b/i],
  ["tech", /\b(tech|technology|software|startup|ai)\b/i],
  ["healthcare", /\b(healthcare|medical|doctor|dental|pharmacy)\b/i],
  ["podcast", /\b(podcast|podcaster)\b/i],
  ["voiceover", /\b(voiceover|voice-over|voice actor)\b/i],
  ["improv", /\b(improv|improvisation|unscripted)\b/i],
  ["live tv", /\b(live tv|live television|broadcast|broadcast-trained)\b/i],
  ["bilingual", /\b(bilingual|multilingual|spanish|mandarin|french|korean|japanese)\b/i]
];

function extractCelebrityLabels(record) {
  const labels = [];
  for (const [header, rawValue] of Object.entries(record)) {
    const value = String(rawValue || "").trim();
    if (!value || SENSITIVE_LABEL_HEADERS.has(header)) continue;
    if ((DIRECT_LABEL_HEADERS.includes(header) || isSocialHeader(header)) && !isFollowerHeader(header)) {
      labels.push(...splitLabelValues(value));
    }
    if (isFollowerHeader(header)) {
      labels.push(...followerLabels(header, value));
    }
    if (["notes", "note", "bio", "biography", "description", "summary", "known_for", "credits", "campaigns", "notable_work"].includes(header)) {
      labels.push(...keywordLabels(value));
    }
    if (isSocialHeader(header) && value) {
      labels.push(socialPlatformLabel(header));
    }
  }
  return dedupeLabels(labels).slice(0, 20);
}

function splitLabelValues(value) {
  if (!value) return [];
  if (value.length > 80) return keywordLabels(value);
  return value
    .split(/[;,|/]/)
    .map(cleanLabel)
    .filter(Boolean);
}

function keywordLabels(value) {
  return KEYWORD_LABELS.filter(([, pattern]) => pattern.test(value)).map(([label]) => label);
}

function mergeLabels(explicitTags, inferredLabels) {
  return dedupeLabels([...splitLabelValues(String(explicitTags || "")), ...inferredLabels]);
}

function cleanLabel(value) {
  const label = String(value || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!label || label.length < 2 || label.length > 48) return "";
  if (/^\d+$/.test(label)) return "";
  return label;
}

function dedupeLabels(labels) {
  const seen = new Set();
  const output = [];
  for (const rawLabel of labels) {
    const label = standardizeLabel(rawLabel);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    output.push(label);
  }
  return output;
}

function standardizeLabel(label) {
  const value = cleanLabel(label);
  const aliases = {
    actress: "actor",
    performer: "actor",
    presenter: "host",
    "tv host": "host",
    "television host": "host",
    ig: "instagram",
    "insta": "instagram",
    "tik tok": "tiktok",
    "you tuber": "youtube",
    "youtuber": "youtube",
    "content creator": "creator"
  };
  return aliases[value] || value;
}

function isSocialHeader(header) {
  return /(instagram|tiktok|tik_tok|youtube|twitter|x_handle|social|handle|followers|subscribers)/.test(header);
}

function socialPlatformLabel(header) {
  if (/instagram/.test(header)) return "instagram";
  if (/tiktok|tik_tok/.test(header)) return "tiktok";
  if (/youtube/.test(header)) return "youtube";
  if (/twitter|x_handle/.test(header)) return "x";
  return "social";
}

function isFollowerHeader(header) {
  return /(followers|subscriber|audience_size|reach)/.test(header);
}

function followerLabels(header, value) {
  const count = parseAudienceCount(value);
  const platform = socialPlatformLabel(header);
  if (!count) return [];
  const tier = count >= 1_000_000
    ? "1m+ audience"
    : count >= 500_000
      ? "500k+ audience"
      : count >= 100_000
        ? "100k+ audience"
        : count >= 10_000
          ? "10k+ audience"
          : "";
  return [platform === "social" ? "" : platform, tier].filter(Boolean);
}

function parseAudienceCount(value) {
  const text = String(value || "").trim().toLowerCase().replaceAll(",", "");
  const match = text.match(/(\d+(?:\.\d+)?)\s*([km])?/);
  if (!match) return 0;
  const number = Number(match[1]);
  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  return Math.round(number * multiplier);
}

function buildImportedNotes(record) {
  return firstValue(record, ["notes", "note", "bio", "biography", "description", "summary"]);
}

function buildImportedMiscNotes(record) {
  const explicit = firstValue(record, ["misc_notes", "misc", "miscellaneous", "other", "other_notes", "additional_notes", "extra_notes"]);
  const rows = [];
  if (explicit) rows.push({ header: "misc_notes", value: explicit });
  for (const item of record.__misc_import_fields || []) {
    if (!item?.value || SENSITIVE_LABEL_HEADERS.has(normalizeHeader(item.header))) continue;
    rows.push({ header: normalizeHeader(item.header), value: item.value });
  }
  return mergeMiscNotes(rows.slice(0, 24).map((item) => makeMiscNote({
    note: `${item.header.replaceAll("_", " ")}: ${item.value}`,
    source: "csv_import",
    field: item.header
  })));
}

function columnNameToIndex(name) {
  return [...name].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function normalizeXlsxPath(path) {
  const parts = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function talentsToCsv(talents = listTalents()) {
  const headers = ["id", "name", "tags", "rate", "notes", "misc_notes", "availability", "past_bookings", "photo_path", "wikidata_item_id", "updated_at"];
  const lines = [headers.join(",")];
  for (const talent of talents) {
    lines.push(headers.map((header) => csvCell(
      header === "tags" ? talent.tags : header === "misc_notes" ? JSON.stringify(talent.misc_notes || []) : talent[header]
    )).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function importCsvFile(path) {
  return importSpreadsheetFile(path);
}

export function importSpreadsheetFile(path, actor = null) {
  const filePath = resolve(APP_ROOT, path);
  const extension = extname(filePath).toLowerCase();
  const content = readFileSync(filePath);
  const records = extension === ".xlsx"
    ? parseXlsx(content)
    : parseCsv(content.toString("utf8"), extension === ".tsv" ? "\t" : ",");
  return importTalentRecords(records, actor);
}

export function importTalentRecords(records, actor = null) {
  const results = [];
  const errors = [];
  const labelReport = [];
  records.forEach((record, index) => {
    try {
      const normalized = normalizeTalentInput(record);
      if (!normalized.name) {
        errors.push({ row: index + 2, error: "Missing talent name." });
        return;
      }
      const result = upsertTalent(normalized, "spreadsheet", actor);
      results.push(result);
      labelReport.push({
        row: index + 2,
        name: result.talent.name,
        labels: normalized.tags
      });
    } catch (error) {
      errors.push({ row: index + 2, error: error.message });
    }
  });
  return {
    rows_seen: records.length,
    imported: results.length,
    created: results.filter((item) => item.action === "created").length,
    updated: results.filter((item) => item.action === "updated").length,
    unchanged: results.filter((item) => item.action === "unchanged").length,
    errors,
    label_report: labelReport.slice(0, 50),
    talents: results.map((item) => item.talent)
  };
}

export function stageSpreadsheetImport(input, actor = null) {
  migrate();
  const rows = parseSpreadsheetRowsContent(input);
  if (rows.length < 2) throw new Error("Spreadsheet must include a header row and at least one data row.");
  const rawHeaders = rows[0].map((header) => String(header || "").trim());
  const proposedMapping = proposeColumnMapping(rawHeaders);
  const analyses = analyzeImportRows(rows, proposedMapping);
  const summary = summarizeImportAnalyses(analyses);
  const timestamp = now();
  const userId = actorUserId(actor);
  const insert = db.prepare(`
    INSERT INTO import_batches
      (filename, status, raw_headers_json, proposed_mapping_json, summary_json, created_by_user_id, updated_by_user_id, created_at, updated_at)
    VALUES (?, 'staged', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.filename || "upload",
    JSON.stringify(rawHeaders),
    JSON.stringify(proposedMapping),
    JSON.stringify(summary),
    userId,
    userId,
    timestamp,
    timestamp
  );
  const batchId = Number(insert.lastInsertRowid);
  const insertRow = db.prepare(`
    INSERT INTO import_rows
      (batch_id, row_number, raw_row_json, normalized_record_json, analysis_json, status, confidence, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const analysis of analyses) {
    insertRow.run(
      batchId,
      analysis.row_number,
      JSON.stringify(analysis.raw_row),
      JSON.stringify(analysis.record),
      JSON.stringify(analysis),
      analysis.status,
      analysis.confidence,
      timestamp,
      timestamp
    );
  }
  createImportReviewSuggestions(batchId, analyses);
  return getImportBatch(batchId);
}

export function getImportBatch(identifier) {
  const row = db.prepare("SELECT * FROM import_batches WHERE id = ?").get(Number(identifier));
  if (!row) throw new Error("Import batch not found.");
  const rows = db.prepare("SELECT * FROM import_rows WHERE batch_id = ? ORDER BY row_number ASC").all(row.id);
  return {
    id: row.id,
    filename: row.filename,
    status: row.status,
    raw_headers: asJson(row.raw_headers_json, []),
    proposed_mapping: asJson(row.proposed_mapping_json, []),
    summary: asJson(row.summary_json, {}),
    rows: rows.map((item) => ({
      id: item.id,
      row_number: item.row_number,
      raw_row: asJson(item.raw_row_json, []),
      record: asJson(item.normalized_record_json, {}),
      analysis: asJson(item.analysis_json, {}),
      status: item.status,
      confidence: item.confidence
    })),
    created_by_user_id: row.created_by_user_id || null,
    updated_by_user_id: row.updated_by_user_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function commitImportBatch(identifier, options = {}, actor = null) {
  const batch = getImportBatch(identifier);
  if (batch.status === "committed") throw new Error("Import batch has already been committed.");
  const mapping = options.mapping ? normalizeColumnMapping(options.mapping) : batch.proposed_mapping;
  const threshold = Number(options.confidence_threshold || IMPORT_REVIEW_THRESHOLD);
  const rows = [batch.raw_headers, ...batch.rows.map((row) => row.raw_row)];
  const analyses = analyzeImportRows(rows, mapping);
  const results = [];
  const skipped = [];

  for (const analysis of analyses) {
    if (!["new", "safe_update"].includes(analysis.status) || analysis.confidence < threshold) {
      skipped.push({
        row: analysis.row_number,
        name: analysis.record.name || "",
        status: analysis.status,
        confidence: analysis.confidence,
        reason: analysis.issues[0] || "Needs review before commit."
      });
      continue;
    }
    try {
      results.push(applySafeImportAnalysis(analysis, actor));
    } catch (error) {
      skipped.push({
        row: analysis.row_number,
        name: analysis.record.name || "",
        status: "error",
        confidence: analysis.confidence,
        reason: error.message
      });
    }
  }

  const summary = {
    rows_seen: analyses.length,
    committed: results.length,
    created: results.filter((item) => item.action === "created").length,
    updated: results.filter((item) => item.action === "updated").length,
    skipped: skipped.length,
    skipped_rows: skipped,
    final_status_counts: countBy(analyses, "status")
  };
  const timestamp = now();
  db.prepare(`
    UPDATE import_batches
    SET status = 'committed', proposed_mapping_json = ?, summary_json = ?, updated_by_user_id = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(mapping), JSON.stringify(summary), actorUserId(actor), timestamp, batch.id);
  const updateRow = db.prepare(`
    UPDATE import_rows
    SET normalized_record_json = ?, analysis_json = ?, status = ?, confidence = ?, updated_at = ?
    WHERE batch_id = ? AND row_number = ?
  `);
  for (const analysis of analyses) {
    updateRow.run(
      JSON.stringify(analysis.record),
      JSON.stringify(analysis),
      analysis.status,
      analysis.confidence,
      timestamp,
      batch.id,
      analysis.row_number
    );
  }
  return { batch: getImportBatch(batch.id), summary, results, skipped };
}

function analyzeImportRows(rows, mapping) {
  if (!rows.length) return [];
  const rawHeaders = rows[0].map((header) => String(header || "").trim());
  const headers = rawHeaders.map(normalizeHeader);
  const columnMapping = normalizeColumnMapping(mapping || proposeColumnMapping(rawHeaders));
  const roster = listTalents("", { includeArchived: true });
  const analyses = rows.slice(1)
    .map((rawRow, index) => analyzeImportRow({
      rowNumber: index + 2,
      headers,
      rawRow,
      mapping: columnMapping,
      roster
    }))
    .filter(Boolean);
  markBatchDuplicateRows(analyses);
  return analyses;
}

function markBatchDuplicateRows(analyses) {
  for (let leftIndex = 0; leftIndex < analyses.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < analyses.length; rightIndex += 1) {
      const left = analyses[leftIndex];
      const right = analyses[rightIndex];
      if (!left.record?.name || !right.record?.name) continue;
      const score = duplicateTalentScore(left.record, right.record);
      if (score.score < 0.9) continue;
      left.status = "conflict";
      right.status = "conflict";
      left.issues.push(`Possible duplicate of import row ${right.row_number}.`);
      right.issues.push(`Possible duplicate of import row ${left.row_number}.`);
      left.diff.conflicts.push({ field: "name", existing: `import row ${right.row_number}: ${right.record.name}`, incoming: left.record.name });
      right.diff.conflicts.push({ field: "name", existing: `import row ${left.row_number}: ${left.record.name}`, incoming: right.record.name });
    }
  }
}

function analyzeImportRow({ rowNumber, headers, rawRow, mapping, roster }) {
  if (!rawRow.some((value) => String(value || "").trim())) return null;
  const rawRecord = mapRawRowToRecord(headers, rawRow, mapping);
  const record = spreadsheetRecordToTalent(rawRecord);
  const normalized = normalizeTalentInput(record);
  const issues = [];
  const mappingConfidence = average(mapping
    .filter((entry) => entry.target !== "ignore" && entry.target !== "sensitive_ignore")
    .map((entry) => Number(entry.confidence || 0)));
  const nameMapping = mapping.find((entry) => entry.target === "name");
  if (!normalized.name) issues.push("No talent name was mapped.");
  if (!nameMapping || nameMapping.confidence < 0.72) issues.push("Name column mapping needs review.");

  const match = normalized.name ? resolveExistingTalent(normalized.name, roster) : null;
  const diff = match?.talent ? safeImportDiff(normalized, match.talent) : {
    fills: [],
    tag_additions: normalized.tags,
    misc_note_additions: normalized.misc_notes,
    conflicts: []
  };
  const confidence = roundConfidence(Math.min(1, (
    (mappingConfidence || 0.5) * 0.45 +
    (nameMapping?.confidence || 0) * 0.25 +
    (match ? match.confidence : 0.86) * 0.2 +
    (normalized.tags.length ? 0.1 : 0.04)
  )));

  let status = "new";
  if (issues.length) status = "needs_review";
  else if (diff.conflicts.length) status = "conflict";
  else if (confidence < IMPORT_REVIEW_THRESHOLD) status = "needs_review";
  else if (match) status = "safe_update";

  if (!normalized.name) status = "error";

  return {
    row_number: rowNumber,
    raw_row: rawRow,
    record: normalized,
    status,
    confidence,
    issues,
    entity_match: match ? {
      id: match.talent.id,
      name: match.talent.name,
      type: match.type,
      confidence: match.confidence
    } : null,
    diff,
    extracted_labels: normalized.tags,
    mapping_warnings: mapping
      .filter((entry) => entry.target === "needs_mapping" || entry.confidence < 0.6)
      .map((entry) => ({ header: entry.header, target: entry.target, suggested_target: entry.suggested_target, confidence: entry.confidence }))
  };
}

function summarizeImportAnalyses(analyses) {
  return {
    rows_seen: analyses.length,
    status_counts: countBy(analyses, "status"),
    new: analyses.filter((row) => row.status === "new").length,
    safe_updates: analyses.filter((row) => row.status === "safe_update").length,
    conflicts: analyses.filter((row) => row.status === "conflict").length,
    needs_review: analyses.filter((row) => row.status === "needs_review").length,
    errors: analyses.filter((row) => row.status === "error").length,
    average_confidence: roundConfidence(average(analyses.map((row) => row.confidence)) || 0)
  };
}

function applySafeImportAnalysis(analysis, actor = null) {
  if (analysis.status === "new") {
    return createTalent(analysis.record, "spreadsheet", actor);
  }
  if (analysis.status !== "safe_update" || !analysis.entity_match?.id) {
    throw new Error("Only new and safe-update rows can be committed automatically.");
  }
  const existing = getTalent(analysis.entity_match.id);
  if (!existing) throw new Error("Matched talent no longer exists.");
  const patch = {};
  const mergedTags = [...new Set([...existing.tags, ...analysis.record.tags])];
  if (mergedTags.length !== existing.tags.length) patch.tags = mergedTags;
  const mergedMiscNotes = mergeMiscNotes(existing.misc_notes, analysis.record.misc_notes);
  if (mergedMiscNotes.length !== existing.misc_notes.length) patch.misc_notes = mergedMiscNotes;
  for (const field of ["rate", "notes", "availability", "past_bookings", "photo_path", "wikidata_item_id"]) {
    if (analysis.record[field] && !existing[field]) patch[field] = analysis.record[field];
  }
  if (!Object.keys(patch).length) {
    return { talent: existing, action: "unchanged", source: "spreadsheet" };
  }
  return patchTalent(existing.id, patch, "spreadsheet", actor);
}

function safeImportDiff(record, existing) {
  const fills = [];
  const conflicts = [];
  const tagAdditions = record.tags.filter((tag) => !existing.tags.includes(tag));
  const miscNoteAdditions = mergeMiscNotes(existing.misc_notes, record.misc_notes).slice(existing.misc_notes.length);
  for (const field of ["rate", "notes", "availability", "past_bookings", "photo_path", "wikidata_item_id"]) {
    const incoming = String(record[field] || "").trim();
    const current = String(existing[field] || "").trim();
    if (!incoming) continue;
    if (!current) fills.push({ field, value: incoming });
    else if (normalizeComparable(current) !== normalizeComparable(incoming)) {
      conflicts.push({ field, existing: current, incoming });
    }
  }
  return { fills, tag_additions: tagAdditions, misc_note_additions: miscNoteAdditions, conflicts };
}

function resolveExistingTalent(name, roster) {
  const normalizedName = normalizePersonName(name);
  let best = null;
  for (const talent of roster) {
    const candidateName = normalizePersonName(talent.name);
    if (!candidateName) continue;
    const confidence = personNameSimilarity(normalizedName, candidateName);
    if (!best || confidence > best.confidence) {
      best = { talent, confidence, type: confidence === 1 ? "exact" : "fuzzy" };
    }
  }
  if (!best || best.confidence < 0.86) return null;
  return {
    talent: best.talent,
    confidence: roundConfidence(best.confidence),
    type: best.confidence === 1 ? "exact" : "fuzzy"
  };
}

function normalizePersonName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function personNameSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenScore = overlap / Math.max(leftTokens.size, rightTokens.size, 1);
  const stringScore = stringSimilarity(left.replaceAll(" ", ""), right.replaceAll(" ", ""));
  return Math.max(tokenScore, stringScore);
}

function normalizeComparable(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = typeof key === "function" ? key(item) : item[key];
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function average(values) {
  const numeric = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!numeric.length) return 0;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

export function exportCsvFile(path) {
  const outputPath = resolve(APP_ROOT, path || "talent-roster.csv");
  writeFileSync(outputPath, talentsToCsv(), "utf8");
  return outputPath;
}

export function backupDatabase(reason = "manual", actor = null) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = now().replace(/[:.]/g, "-");
  const filename = `talent-${stamp}.sqlite`;
  const outputPath = resolve(BACKUP_DIR, filename);
  if (!outputPath.startsWith(BACKUP_DIR)) throw new Error("Invalid backup path.");
  const escaped = outputPath.replaceAll("'", "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  const sizeBytes = statSync(outputPath).size;
  db.prepare(`
    INSERT INTO backup_runs (path, size_bytes, reason, created_by_user_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(outputPath, sizeBytes, String(reason || "manual"), actorUserId(actor), now());
  pruneOldBackups();
  return { path: outputPath, filename, size_bytes: sizeBytes };
}

export function listBackups(limit = 10) {
  return db.prepare(`
    SELECT id, path, size_bytes, reason, created_by_user_id, created_at
    FROM backup_runs
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(Number(limit) || 10).map((row) => ({
    ...row,
    filename: basename(row.path || "")
  }));
}

export function latestBackup() {
  return listBackups(1)[0] || null;
}

export function usageAnalytics() {
  const history = recentMatchHistory(500);
  const talentCounts = new Map();
  const requestedTags = new Map();
  const discardReasons = [];
  let approved = 0;
  let discarded = 0;
  for (const entry of history) {
    if (entry.outcome === "approved") approved += 1;
    if (entry.outcome === "discarded") {
      discarded += 1;
      if (entry.feedback) discardReasons.push({ match_id: entry.id, reason: entry.feedback, created_at: entry.updated_at || entry.created_at });
    }
    if (entry.outcome === "approved") {
      for (const item of entry.result?.shortlist || []) {
        const key = item.talent_id || item.name;
        const current = talentCounts.get(key) || { talent_id: item.talent_id || null, name: item.name, approvals: 0 };
        current.approvals += 1;
        talentCounts.set(key, current);
      }
    }
    const req = entry.requirements || {};
    for (const item of [...(req.skills || []), ...(req.tone || []), ...(req.category || [])]) {
      const value = String(item.value || item || "").trim();
      if (!value) continue;
      requestedTags.set(value, (requestedTags.get(value) || 0) + 1);
    }
  }
  const weekRows = db.prepare(`
    SELECT strftime('%Y-%W', created_at) AS week,
           SUM(CASE WHEN outcome = 'approved' THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN outcome = 'discarded' THEN 1 ELSE 0 END) AS discarded,
           COUNT(*) AS total
    FROM match_history
    GROUP BY week
    ORDER BY week DESC
    LIMIT 12
  `).all();
  return {
    totals: {
      matches: history.length,
      approved,
      discarded,
      draft: history.length - approved - discarded,
      suggestions_open: db.prepare("SELECT count(*) AS c FROM suggestions WHERE status = 'open'").get().c,
      active_talent: db.prepare("SELECT count(*) AS c FROM talents WHERE archived_at = ''").get().c,
      archived_talent: db.prepare("SELECT count(*) AS c FROM talents WHERE archived_at != ''").get().c
    },
    most_matched_talent: [...talentCounts.values()].sort((a, b) => b.approvals - a.approvals || a.name.localeCompare(b.name)).slice(0, 10),
    most_requested_terms: [...requestedTags.entries()].map(([term, count]) => ({ term, count })).sort((a, b) => b.count - a.count || a.term.localeCompare(b.term)).slice(0, 12),
    weekly_outcomes: weekRows,
    recent_discard_reasons: discardReasons.slice(0, 12)
  };
}

function pruneOldBackups({ keepDaily = 14, keepMonthly = 6 } = {}) {
  const backups = readdirSync(BACKUP_DIR)
    .filter((name) => /^talent-.+\.sqlite$/.test(name))
    .map((name) => {
      const path = resolve(BACKUP_DIR, name);
      return { name, path, mtimeMs: statSync(path).mtimeMs, date: backupDateFromName(name) };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keep = new Set(backups.slice(0, keepDaily).map((backup) => backup.path));
  const monthly = new Set();
  for (const backup of backups) {
    const month = backup.date ? backup.date.slice(0, 7) : "";
    if (!month || monthly.has(month) || monthly.size >= keepMonthly) continue;
    monthly.add(month);
    keep.add(backup.path);
  }
  for (const backup of backups) {
    if (keep.has(backup.path)) continue;
    unlinkSync(backup.path);
  }
}

function backupDateFromName(name) {
  const match = /^talent-(\d{4}-\d{2}-\d{2})T/.exec(name);
  return match ? match[1] : "";
}

export function uploadedFilename(photoPath) {
  return photoPath ? basename(photoPath) : "";
}

export async function matchBrief(brief, enrichWeb = false, actor = null) {
  return runMatchBrief({ brief, enrichWeb, actor, persist: true });
}

export async function previewMatchBrief(brief, options = {}) {
  return runMatchBrief({
    brief,
    enrichWeb: Boolean(options.enrichWeb),
    actor: options.actor || null,
    persist: false
  });
}

async function runMatchBrief({ brief, enrichWeb = false, actor = null, persist = true }) {
  const trimmedBrief = String(brief || "").trim();
  if (!trimmedBrief) throw new Error("Brief is required.");
  const briefPolicy = policyCheckClientBrief(trimmedBrief);
  const matchableBrief = briefPolicy.matchable || "";
  const parsedRequirements = parseInquiryRequirements(matchableBrief, briefPolicy);

  const roster = listTalents();
  if (!roster.length) throw new Error("Roster is empty. Add or import talent before matching.");

  const rosterSnapshot = roster.map(sourceSnapshotForTalent);
  const history = matchableHistory(recentMatchHistory(8));
  let result;
  let modelSource = "local-fallback";
  let modelName = "heuristic";

  if (ANTHROPIC_API_KEY) {
    try {
      result = await claudeMatch({ brief: matchableBrief || trimmedBrief, originalBrief: trimmedBrief, requirements: parsedRequirements, rosterSnapshot, history, briefPolicy });
      modelSource = "claude";
      modelName = CLAUDE_MODEL;
    } catch (error) {
      result = fallbackMatch(matchableBrief, roster, history, parsedRequirements, briefPolicy);
      result.flags_for_reviewer.push(`Claude request failed, local fallback used: ${error.message}`);
    }
  } else {
    result = fallbackMatch(matchableBrief, roster, history, parsedRequirements, briefPolicy);
    result.flags_for_reviewer.push("ANTHROPIC_API_KEY is not configured, so this result used the local fallback matcher.");
  }

  const requirements = normalizeRequirementObject(result.requirements, parsedRequirements);
  result.requirements = requirements;
  result.flags_for_reviewer = [...(result.flags_for_reviewer || []), ...briefPolicy.flags];
  result = normalizeMatchResult(result);
  const historyId = persist ? storeMatchHistory({
    brief: trimmedBrief,
    result,
    requirements,
    rosterSnapshot,
    enrichWeb,
    modelSource,
    modelName,
    actor
  }) : null;
  if (persist && enrichWeb && ANTHROPIC_API_KEY) {
    result = await enrichMatchWithLiveSearch({
      matchHistoryId: historyId,
      result,
      requirements,
      roster,
      actor
    });
    modelSource = `${modelSource}+gap-live-search`;
    updateStoredMatchResult(historyId, result, requirements, modelSource, modelName, actor);
  } else if (enrichWeb && !ANTHROPIC_API_KEY) {
    result.flags_for_reviewer.push("Live external gap search skipped because ANTHROPIC_API_KEY is not configured.");
    result = normalizeMatchResult(result);
    if (persist) updateStoredMatchResult(historyId, result, requirements, modelSource, modelName, actor);
  } else if (enrichWeb && !persist) {
    result.flags_for_reviewer.push("Live external gap search skipped during non-persistent evaluation runs.");
    result = normalizeMatchResult(result);
  }

  return { history_id: historyId, model_source: modelSource, model_name: modelName, requirements, result };
}

async function claudeMatch({ brief, originalBrief, requirements, rosterSnapshot, history, briefPolicy }) {
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: MATCH_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: JSON.stringify({
        client_brief: originalBrief || brief,
        matchable_client_brief: brief,
        ignored_client_brief_policy_flags: briefPolicy?.flags || [],
        locally_parsed_requirements: requirements,
        roster: rosterSnapshot,
        recent_match_history: history.map((entry) => ({
          brief: entry.brief,
          requirements: entry.requirements,
          outcome: entry.outcome,
          feedback: entry.feedback,
          shortlist_names: (entry.result.shortlist || []).map((item) => item.name)
        })),
        web_enrichment_allowed: false,
        web_enrichment_policy: "Do not perform live web enrichment inside this main match pass. The platform runs a separate scoped gap-search step after roster-only matching."
      }, null, 2)
    }]
  };

  const text = anthropicText(await anthropicMessages(body));

  return parseJsonFromText(text);
}

function parseJsonFromText(text) {
  if (!text) throw new Error("Claude returned an empty response.");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Claude response was not valid JSON.");
  }
}

async function enrichMatchWithLiveSearch({ matchHistoryId, result, requirements, roster, actor = null }) {
  const candidates = candidateItemsForLiveSearch(result)
    .slice(0, Math.max(1, LIVE_SEARCH_TOP_N))
    .map((item) => ({
      item,
      talent: roster.find((talent) => Number(talent.id) === Number(item.talent_id))
    }))
    .filter((entry) => entry.talent && !entry.talent.archived_at);
  const requirementsToCheck = mustHaveRequirementKeys(requirements);
  if (!candidates.length || !requirementsToCheck.length) return result;

  const gaps = [];
  for (const candidate of candidates) {
    for (const requirement of requirementsToCheck) {
      if (candidateCoversRequirement(candidate.talent, requirement)) continue;
      gaps.push({ ...candidate, requirement });
      if (gaps.length >= LIVE_SEARCH_MAX_GAPS) break;
    }
    if (gaps.length >= LIVE_SEARCH_MAX_GAPS) break;
  }
  if (!gaps.length) return result;

  const findings = [];
  for (const gap of gaps) {
    const finding = await findOrFetchLiveSearch(matchHistoryId, gap, actor).catch((error) => ({
      match_history_id: matchHistoryId,
      talent_id: gap.talent.id,
      requirement_key: gap.requirement.key,
      query: liveSearchQuery(gap.talent, gap.requirement),
      findings: [],
      confidence: "inconclusive",
      rationale: `Live search attempted but unavailable: ${error.message}`,
      status: "error",
      fetched_at: now()
    }));
    findings.push(finding);
  }
  return applyLiveSearchFindings(result, findings);
}

function candidateItemsForLiveSearch(result = {}) {
  const byId = new Map();
  for (const item of [...(result.shortlist || []), ...(result.excluded_but_close || [])]) {
    if (!item?.talent_id || byId.has(Number(item.talent_id))) continue;
    byId.set(Number(item.talent_id), item);
  }
  return [...byId.values()];
}

function mustHaveRequirementKeys(requirements = {}) {
  const keys = [];
  const add = (group, item, confidence = 0.75) => {
    const value = typeof item === "string" ? item : item?.value || item?.raw || "";
    const text = String(value || "").trim();
    if (!text) return;
    const mustHave = typeof item === "object" && item ? item.must_have ?? item.required ?? item.mustHave : undefined;
    const finalConfidence = Number(typeof item === "object" && item ? item.confidence : confidence) || confidence;
    if (mustHave === false || finalConfidence < 0.72) return;
    keys.push({
      key: `${group}:${normalizeComparable(text).replaceAll(" ", "-")}`,
      group,
      label: text,
      terms: requirementTerms(text)
    });
  };
  for (const item of requirements.skills || []) add("skill", item);
  for (const item of requirements.category || []) add("category", item);
  if (requirements.location?.city || requirements.location?.raw) add("location", requirements.location, requirements.location.confidence || 0.75);
  return dedupeRequirementKeys(keys).slice(0, 8);
}

function dedupeRequirementKeys(keys = []) {
  const seen = new Set();
  return keys.filter((item) => {
    if (!item.key || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

function requirementTerms(label) {
  const normalized = normalizeComparable(label);
  const terms = new Set([normalized, ...extractTerms(label)]);
  const synonyms = {
    bilingual: ["multilingual", "fluent in two languages"],
    host: ["presenter", "emcee", "mc"],
    "live tv experience": ["live tv", "live television", "broadcast"],
    spokesperson: ["brand ambassador", "on camera", "on-camera"],
    eyewear: ["glasses", "optical", "frames"],
    "spanish speaking": ["spanish", "espanol", "español"],
    "mandarin speaking": ["mandarin", "chinese"]
  };
  for (const term of [...terms]) {
    for (const synonym of synonyms[term] || []) terms.add(synonym);
  }
  return [...terms].filter(Boolean).slice(0, 8);
}

function candidateCoversRequirement(talent, requirement) {
  const fields = {
    tags: talent.tags.join(" "),
    notes: talent.notes,
    past_bookings: talent.past_bookings,
    misc_notes: summarizeMiscNotes(talent.misc_notes),
    wikidata_summary: talent.wikidata_summary,
    public_sources: summarizePublicSources(talent.public_sources)
  };
  return Object.entries(fields).some(([, value]) => {
    const text = normalizeComparable(value);
    return requirement.terms.some((term) => text.includes(normalizeComparable(term)));
  });
}

async function findOrFetchLiveSearch(matchHistoryId, gap, actor = null) {
  const cached = cachedLiveSearch(gap.talent.id, gap.requirement.key);
  if (cached) {
    return cloneLiveSearchForMatch(matchHistoryId, cached, gap, actor);
  }
  const query = liveSearchQuery(gap.talent, gap.requirement);
  const snippets = await runScopedLiveSearch(query, gap);
  const classified = await classifyLiveSearchFinding(gap, snippets);
  return insertLiveSearchFinding({
    match_history_id: matchHistoryId,
    talent_id: gap.talent.id,
    requirement_key: gap.requirement.key,
    query,
    findings: snippets,
    confidence: classified.confidence,
    rationale: classified.rationale,
    status: "ok",
    fetched_at: now()
  });
}

function cachedLiveSearch(talentId, requirementKey) {
  const cutoff = new Date(Date.now() - LIVE_SEARCH_CACHE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const row = db.prepare(`
    SELECT * FROM match_live_search
    WHERE talent_id = ?
      AND requirement_key = ?
      AND fetched_at >= ?
      AND status = 'ok'
    ORDER BY fetched_at DESC, id DESC
    LIMIT 1
  `).get(Number(talentId), requirementKey, cutoff);
  return liveSearchFromRow(row);
}

function cloneLiveSearchForMatch(matchHistoryId, cached, gap, actor = null) {
  return insertLiveSearchFinding({
    match_history_id: matchHistoryId,
    talent_id: gap.talent.id,
    requirement_key: gap.requirement.key,
    query: cached.query,
    findings: cached.findings,
    confidence: cached.confidence,
    rationale: cached.rationale,
    status: "cached",
    fetched_at: now()
  });
}

function insertLiveSearchFinding(input = {}) {
  const insert = db.prepare(`
    INSERT INTO match_live_search
      (match_history_id, talent_id, requirement_key, query, findings_json, confidence, rationale, status, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.match_history_id || null,
    Number(input.talent_id),
    String(input.requirement_key || ""),
    String(input.query || ""),
    JSON.stringify(input.findings || []),
    normalizeLiveConfidence(input.confidence),
    String(input.rationale || ""),
    String(input.status || "ok"),
    input.fetched_at || now()
  );
  return liveSearchFromRow(db.prepare("SELECT * FROM match_live_search WHERE id = ?").get(Number(insert.lastInsertRowid)));
}

function liveSearchFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    match_history_id: row.match_history_id,
    talent_id: row.talent_id,
    requirement_key: row.requirement_key,
    query: row.query,
    findings: asJson(row.findings_json, []),
    confidence: normalizeLiveConfidence(row.confidence),
    rationale: row.rationale || "",
    status: row.status || "ok",
    fetched_at: row.fetched_at
  };
}

function liveSearchQuery(talent, requirement) {
  return `"${talent.name}" ${requirement.label}`;
}

async function runScopedLiveSearch(query, gap) {
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 900,
    system: "Use web_search only for the named roster candidate and requirement. Return JSON only.",
    tools: [{ type: CLAUDE_WEB_SEARCH_TOOL, name: "web_search", max_uses: Math.max(1, LIVE_SEARCH_MAX_USES) }],
    messages: [{
      role: "user",
      content: JSON.stringify({
        task: "Find public, professional evidence for this one roster candidate and one requirement. Do not suggest any other person.",
        candidate_name: gap.talent.name,
        requirement: gap.requirement.label,
        query,
        return_schema: {
          findings: [{ snippet: "", source_url: "", source_title: "" }]
        }
      })
    }]
  };
  const data = await anthropicMessages(body);
  const text = anthropicText(data);
  const parsed = parseJsonFromText(text);
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  return findings
    .map((finding) => ({
      snippet: singleLine(finding.snippet || finding.text || ""),
      source_url: String(finding.source_url || finding.url || "").trim(),
      source_title: singleLine(finding.source_title || finding.title || "Public source")
    }))
    .filter((finding) => finding.snippet || finding.source_url)
    .slice(0, 4);
}

async function classifyLiveSearchFinding(gap, findings = []) {
  if (!findings.length) {
    return {
      confidence: "inconclusive",
      rationale: `Unable to verify ${gap.requirement.label} via scoped live search.`
    };
  }
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 500,
    system: "Classify public evidence for one roster candidate. Return JSON only.",
    messages: [{
      role: "user",
      content: JSON.stringify({
        candidate_name: gap.talent.name,
        requirement_key: gap.requirement.key,
        requirement: gap.requirement.label,
        snippets: findings,
        return_schema: {
          confidence: "supports|contradicts|inconclusive",
          rationale: "one sentence"
        }
      })
    }]
  };
  const data = await anthropicMessages(body);
  const parsed = parseJsonFromText(anthropicText(data));
  return {
    confidence: normalizeLiveConfidence(parsed.confidence),
    rationale: singleLine(parsed.rationale || "")
  };
}

function normalizeLiveConfidence(value) {
  const text = String(value || "").toLowerCase();
  if (text === "supports" || text === "contradicts") return text;
  return "inconclusive";
}

async function anthropicMessages(body) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Anthropic request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function anthropicText(data = {}) {
  return (data.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function applyLiveSearchFindings(result, findings = []) {
  const normalized = normalizeMatchResult(result);
  const byTalent = new Map();
  for (const finding of findings.filter(Boolean)) {
    const list = byTalent.get(Number(finding.talent_id)) || [];
    list.push(finding);
    byTalent.set(Number(finding.talent_id), list);
  }
  for (const item of normalized.shortlist || []) {
    const liveFindings = byTalent.get(Number(item.talent_id)) || [];
    if (!liveFindings.length) continue;
    item.live_search_findings = liveFindings.map(publicLiveSearchFinding);
    for (const finding of liveFindings) {
      const positiveWeight = finding.confidence === "supports" ? 1 : 0;
      const negativeWeight = finding.confidence === "contradicts" ? -3 : 0;
      item.score_drivers.push({
        label: `Live search ${finding.confidence}: ${finding.requirement_key}`,
        field: "live_search",
        term: finding.requirement_key,
        weight: positiveWeight || negativeWeight,
        source: liveSearchSource(finding)
      });
      item.claims.push({
        claim: finding.rationale || `Live search for ${finding.requirement_key} was ${finding.confidence}.`,
        source: liveSearchSource(finding)
      });
      if (finding.confidence === "contradicts") {
        item.cautions ||= [];
        item.cautions.push(`Live search may contradict roster evidence for ${finding.requirement_key}.`);
      }
    }
    item.claims = dedupeClaims(item.claims);
    item.score_drivers = normalizeScoreDrivers(item.score_drivers, item.claims);
  }
  if (findings.length) {
    normalized.flags_for_reviewer.push("Live external findings are unreviewed tier-3 evidence; double-check source URLs before external use.");
  }
  return normalizeMatchResult(normalized);
}

function publicLiveSearchFinding(finding) {
  return {
    id: finding.id,
    requirement_key: finding.requirement_key,
    query: finding.query,
    findings: finding.findings,
    confidence: finding.confidence,
    rationale: finding.rationale,
    status: finding.status,
    fetched_at: finding.fetched_at
  };
}

function liveSearchSource(finding) {
  const first = finding.findings?.[0] || {};
  return {
    type: "live_search",
    field: "live_search",
    value: first.snippet || finding.rationale || "",
    updated_at: finding.fetched_at,
    url: first.source_url || "",
    title: first.source_title || "Live search finding",
    confidence: finding.confidence,
    requirement_key: finding.requirement_key,
    findings: finding.findings || []
  };
}

function fallbackMatch(brief, roster, history, requirements = parseInquiryRequirements(brief), briefPolicy = policyCheckClientBrief(brief)) {
  const terms = extractTerms(brief);
  const criteria = interpretCriteria(brief, terms, briefPolicy);
  const learning = fallbackLearningProfile(history, terms, brief);
  const scored = roster.map((talent) => scoreTalent(talent, terms, history, brief, learning, requirements));
  scored.sort((a, b) => b.score - a.score || a.talent.name.localeCompare(b.talent.name));

  const shortlist = scored
    .filter((entry) => entry.score > 0 && !entry.availabilityBlocked)
    .slice(0, 6)
    .map((entry) => ({
      talent_id: entry.talent.id,
      name: entry.talent.name,
      fit: entry.score >= 10 ? "High" : entry.score >= 5 ? "Medium" : "Low",
      score: entry.score,
      rationale: entry.rationale,
      claims: entry.claims,
      score_drivers: entry.scoreDrivers,
      cautions: entry.cautions
    }));

  const shortlistedIds = new Set(shortlist.map((item) => item.talent_id));
  const blockedClose = scored
    .filter((entry) => entry.availabilityBlocked && !shortlistedIds.has(entry.talent.id))
    .sort((a, b) => b.preAvailabilityScore - a.preAvailabilityScore || a.talent.name.localeCompare(b.talent.name));
  const otherClose = scored
    .filter((entry) => !shortlistedIds.has(entry.talent.id))
    .filter((entry) => !entry.availabilityBlocked);
  const excluded = [...blockedClose, ...otherClose]
    .slice(0, 4)
    .map((entry) => ({
      talent_id: entry.talent.id,
      name: entry.talent.name,
      reason: entry.availabilityBlocked
        ? entry.availabilityBlocked
        : entry.score > 0 ? "Some evidence matched, but the sourced fit was weaker than the shortlist." : "No sourced roster fields clearly matched the brief.",
      missing_or_weak_evidence: entry.missingEvidence
    }));

  return {
    requirements,
    criteria,
    shortlist,
    excluded_but_close: excluded,
    flags_for_reviewer: ["Requires review before external use.", ...briefPolicy.flags],
    review_required: true,
    review_required_notice: "Requires review before external use."
  };
}

function extractTerms(brief) {
  const stop = new Set([
    "a", "an", "and", "are", "as", "at", "be", "brand", "brief", "by", "client", "for", "from",
    "in", "is", "it", "needs", "of", "on", "or", "our", "that", "the", "their", "to", "wants",
    "we", "with", "who", "would"
  ]);
  const words = String(brief).toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
  const expanded = new Set(words.filter((word) => !stop.has(word)));
  const aliases = {
    eyewear: ["glasses", "optical", "optometry", "frames"],
    glasses: ["eyewear", "optical", "frames"],
    spokesperson: ["host", "presenter", "broadcast", "on-camera", "teleprompter"],
    family: ["parent", "mom", "dad", "kids"],
    wellness: ["health", "healthcare", "fitness"],
    luxury: ["fashion", "editorial", "premium"]
  };
  for (const word of [...expanded]) {
    for (const alias of aliases[word] || []) expanded.add(alias);
  }
  return [...expanded].slice(0, 36);
}

function interpretCriteria(brief, terms, briefPolicy = policyCheckClientBrief(brief)) {
  const lower = brief.toLowerCase();
  const stated = terms.slice(0, 10).map((term) => ({ criterion: term, source: "client_brief" }));
  const inferred = [];
  const ambiguous = [];

  if (/(spokesperson|host|presenter|interview|camera)/.test(lower)) {
    inferred.push({
      criterion: "Evidence of on-camera speaking, hosting, broadcast, or spokesperson work",
      justification: "The brief asks for a spokesperson-style role, so speaking delivery matters."
    });
  }
  if (/(eyewear|glasses|optical|optometry|frames)/.test(lower)) {
    inferred.push({
      criterion: "Credible connection to eyewear, optical frames, or eye-care context",
      justification: "The brief references eyewear or adjacent optical language."
    });
  }
  if (/(family|parent|mom|dad|kids)/.test(lower)) {
    inferred.push({
      criterion: "Family-oriented lived-context or past family-brand work",
      justification: "The brief includes family language, which may affect audience credibility."
    });
  }
  if (!/(budget|rate|\$|fee)/.test(lower)) {
    ambiguous.push({ criterion: "Budget/rate tolerance", reason: "The brief does not state a rate or budget ceiling." });
  }
  if (!/(date|week|month|tomorrow|today|availability|deadline|shoot)/.test(lower)) {
    ambiguous.push({ criterion: "Timing and shoot constraints", reason: "The brief does not specify dates, location, or delivery timing." });
  }
  for (const category of [...new Set((briefPolicy.blocked || []).map((entry) => entry.category))]) {
    ambiguous.push({
      criterion: `Ignored protected/private criterion: ${category}`,
      reason: "Protected or private attributes are not used as matching criteria."
    });
  }

  return { stated, inferred, ambiguous };
}

function parseInquiryRequirements(brief, briefPolicy = policyCheckClientBrief(brief)) {
  const text = String(brief || "");
  const lower = text.toLowerCase();
  return normalizeRequirementObject({
    skills: parseRequirementList(lower, [
      ["bilingual", /\b(bilingual|fluent in two languages|multilingual)\b/],
      ["Spanish-speaking", /\b(spanish|espanol|español)\b/],
      ["Mandarin-speaking", /\b(mandarin|chinese)\b/],
      ["host", /\b(host|presenter|emcee|mc)\b/],
      ["live TV experience", /\b(live tv|live television|broadcast|newsroom)\b/],
      ["teleprompter", /\b(teleprompter|prompter)\b/],
      ["improv", /\b(improv|improvisation|unscripted)\b/],
      ["voiceover", /\b(voiceover|voice-over|vo)\b/],
      ["spokesperson", /\b(spokesperson|brand ambassador|on-camera)\b/]
    ]),
    tone: parseRequirementList(lower, [
      ["warm", /\b(warm|friendly|approachable)\b/],
      ["polished", /\b(polished|premium|professional)\b/],
      ["comedic", /\b(comedic|comedy|funny|humor|humour)\b/],
      ["luxury", /\b(luxury|editorial|high-end|premium)\b/],
      ["family-friendly", /\b(family-friendly|family friendly|parent|kids)\b/],
      ["credible", /\b(credible|expert|trusted|authoritative)\b/]
    ]),
    location: parseLocationRequirement(lower),
    budget_range: parseBudgetRequirement(lower),
    availability_window: parseAvailabilityRequirement(lower),
    category: parseRequirementList(lower, [
      ["eyewear", /\b(eyewear|glasses|optical|optometry|frames)\b/],
      ["fitness", /\b(fitness|workout|training|athlete|wellness)\b/],
      ["beauty", /\b(beauty|makeup|skincare|cosmetic)\b/],
      ["fashion", /\b(fashion|style|apparel|runway)\b/],
      ["healthcare", /\b(healthcare|health care|medical|dental|pharma)\b/],
      ["food", /\b(food|restaurant|grocery|snack)\b/],
      ["tech", /\b(tech|software|app|saas|gadget)\b/]
    ]),
    flags: briefPolicy.flags
  });
}

function parseRequirementList(lower, patterns) {
  return patterns
    .filter(([, pattern]) => pattern.test(lower))
    .map(([value]) => ({ value, source: "client_brief", confidence: 0.9 }));
}

function parseLocationRequirement(lower) {
  const locations = [
    ["Los Angeles", "CA", /\b(la|l\.a\.|los angeles|la-based|los angeles-based)\b/],
    ["New York", "NY", /\b(nyc|new york|brooklyn|manhattan|ny-based)\b/],
    ["Atlanta", "GA", /\b(atlanta|atl)\b/],
    ["Chicago", "IL", /\b(chicago)\b/],
    ["Miami", "FL", /\b(miami|south florida)\b/]
  ];
  for (const [city, region, pattern] of locations) {
    if (pattern.test(lower)) {
      return { raw: pattern.exec(lower)?.[0] || city, city, region, remote_ok: /\b(remote|virtual|self-tape|self tape)\b/.test(lower), confidence: 0.9 };
    }
  }
  if (/\b(remote|virtual|self-tape|self tape)\b/.test(lower)) {
    return { raw: "remote", city: "", region: "", remote_ok: true, confidence: 0.86 };
  }
  return { raw: "", city: "", region: "", remote_ok: null, confidence: 0 };
}

function parseBudgetRequirement(lower) {
  const range = /\$?\s*(\d+(?:[.,]\d+)?)\s*([km])?\s*(?:-|to|–)\s*\$?\s*(\d+(?:[.,]\d+)?)\s*([km])?/i.exec(lower);
  if (range) {
    const min = parseMoneyAmount(range[1], range[2]);
    const max = parseMoneyAmount(range[3], range[4] || range[2]);
    return { raw: range[0], currency: "USD", min, max, confidence: 0.92 };
  }
  const single = /(?:(budget|rate|fee|under|up to|around|approx(?:imately)?|max|maximum|not over)\s*(?:\$|usd)?\s*(\d+(?:[.,]\d+)?)\s*([km])?\b|(?:\$|usd)\s*(\d+(?:[.,]\d+)?)\s*([km])?)/i.exec(lower);
  if (single) {
    const amount = parseMoneyAmount(single[2] || single[4], single[3] || single[5]);
    const isCeiling = /\b(under|up to|max|maximum|not over)\b/.test(single[0]);
    return { raw: single[0], currency: "USD", min: isCeiling ? null : amount, max: amount, confidence: 0.9 };
  }
  return { raw: "", currency: "USD", min: null, max: null, confidence: 0 };
}

function parseMoneyAmount(value, suffix = "") {
  const numeric = Number(String(value || "").replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;
  if (String(suffix || "").toLowerCase() === "m") return Math.round(numeric * 1_000_000);
  if (String(suffix || "").toLowerCase() === "k") return Math.round(numeric * 1_000);
  return Math.round(numeric);
}

function parseAvailabilityRequirement(lower) {
  const isoRange = /\b(\d{4}-\d{2}-\d{2})\s*(?:-|to|through)\s*(\d{4}-\d{2}-\d{2})\b/i.exec(lower);
  if (isoRange) return { raw: isoRange[0], start: isoRange[1], end: isoRange[2], confidence: 0.94 };
  const isoSingle = /\b(\d{4}-\d{2}-\d{2})\b/.exec(lower);
  if (isoSingle) return { raw: isoSingle[0], start: isoSingle[1], end: isoSingle[1], confidence: 0.9 };
  const monthRange = monthNameDateRangeInput(lower);
  if (monthRange) return { raw: monthRange.raw, start: monthRange.start, end: monthRange.end, confidence: 0.88 };
  const monthSingle = monthNameDateInput(lower, { includeRaw: true });
  if (monthSingle) return { raw: monthSingle.raw, start: monthSingle.date, end: monthSingle.date, confidence: 0.86 };
  const patterns = [
    ["today", /\btoday\b/],
    ["tomorrow", /\btomorrow\b/],
    ["this week", /\bthis week\b/],
    ["next week", /\bnext week\b/],
    ["this month", /\bthis month\b/],
    ["next month", /\bnext month\b/],
    ["weekend", /\bweekend\b/],
    ["urgent", /\b(urgent|asap|rush)\b/]
  ];
  for (const [label, pattern] of patterns) {
    if (pattern.test(lower)) return { raw: label, start: "", end: "", confidence: 0.82 };
  }
  const shoot = /\b(shoot|record|film|tape|available)\s+(?:on|by|for)?\s*([a-z]{3,9}\s+\d{1,2}|\d{1,2}\/\d{1,2})/i.exec(lower);
  if (shoot) return { raw: shoot[0], start: shoot[2], end: "", confidence: 0.78 };
  return { raw: "", start: "", end: "", confidence: 0 };
}

function monthNameDateInput(value, options = {}) {
  const text = String(value || "");
  const monthPattern = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const match = new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s*(\\d{4})?\\b`, "i").exec(text);
  if (!match) return options.includeRaw ? null : "";
  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : new Date().getFullYear();
  const date = isoDateFromParts(year, month, day);
  if (!date) return options.includeRaw ? null : "";
  return options.includeRaw ? { raw: match[0], date } : date;
}

function monthNameDateRangeInput(value) {
  const text = String(value || "");
  const monthPattern = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const pattern = new RegExp(
    `\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s*(\\d{4})?\\s*(?:-|to|through)\\s*(?:(?:${monthPattern})\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s*(\\d{4})?\\b`,
    "i"
  );
  const match = pattern.exec(text);
  if (!match) return null;
  const startMonth = monthNumber(match[1]);
  const startDay = Number(match[2]);
  const startYear = match[3] ? Number(match[3]) : Number(match[6] || new Date().getFullYear());
  const endMonth = match[4] ? monthNumber(match[4]) : startMonth;
  const endDay = Number(match[5]);
  const endYear = match[6] ? Number(match[6]) : startYear;
  const start = isoDateFromParts(startYear, startMonth, startDay);
  const end = isoDateFromParts(endYear, endMonth, endDay);
  if (!start || !end) return null;
  return end < start ? { raw: match[0], start: end, end: start } : { raw: match[0], start, end };
}

function monthNumber(value) {
  const key = String(value || "").toLowerCase().slice(0, 3);
  return {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12
  }[key] || 0;
}

function isoDateFromParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return date.toISOString().slice(0, 10);
}

function normalizeRequirementObject(value, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    skills: normalizeRequirementItems(source.skills, fallback.skills),
    tone: normalizeRequirementItems(source.tone, fallback.tone),
    location: normalizeRequirementSingleton(source.location, fallback.location, { raw: "", city: "", region: "", remote_ok: null, confidence: 0 }),
    budget_range: normalizeRequirementSingleton(source.budget_range || source.budgetRange, fallback.budget_range, { raw: "", currency: "USD", min: null, max: null, confidence: 0 }),
    availability_window: normalizeRequirementSingleton(source.availability_window || source.availabilityWindow, fallback.availability_window, { raw: "", start: "", end: "", confidence: 0 }),
    category: normalizeRequirementItems(source.category || source.categories, fallback.category),
    flags: Array.isArray(source.flags) ? source.flags.map((flag) => String(flag).trim()).filter(Boolean) : fallback.flags || []
  };
}

function normalizeRequirementItems(value, fallback = []) {
  const items = Array.isArray(value) && value.length ? value : fallback || [];
  return items
    .map((item) => {
      const rawValue = typeof item === "string" ? item : item?.value;
      const trimmed = String(rawValue || "").trim();
      if (!trimmed) return null;
      return {
        value: trimmed,
        source: String(item?.source || "client_brief"),
        confidence: roundConfidence(Number(item?.confidence ?? 0.75))
      };
    })
    .filter(Boolean);
}

function normalizeRequirementSingleton(value, fallback, defaults) {
  const item = value && typeof value === "object" ? value : fallback && typeof fallback === "object" ? fallback : {};
  return { ...defaults, ...item, confidence: roundConfidence(Number(item.confidence || 0)) };
}

function scoreTalent(talent, terms, history, brief, learning = fallbackLearningProfile(history, terms, brief), requirements = {}) {
  let score = 0;
  const claims = [];
  const scoreDrivers = [];
  const matchedTerms = new Set();
  const fieldWeights = {
    tags: 3,
    past_bookings: 4,
    notes: 2,
    misc_notes: 2,
    availability: 1,
    rate: 1,
    public_sources: 3
  };

  for (const field of PUBLIC_ROSTER_FIELDS) {
    const text = talentFieldText(talent, field);
    const lower = text.toLowerCase();
    for (const term of terms) {
      if (!term || !lower.includes(term.toLowerCase())) continue;
      const source = sourceForTalentField(talent, field, text, term);
      const baseWeight = fieldWeights[field] || 1;
      const weight = roundScore(baseWeight * (learning.fieldMultipliers[field] || 1) * (learning.termMultipliers[term] || 1));
      score += weight;
      matchedTerms.add(term);
      claims.push({
        claim: `${talent.name} has roster evidence for "${term}" in ${fieldLabel(field)}.`,
        source
      });
      scoreDrivers.push({
        label: `${fieldLabel(field)} matched "${term}"`,
        field,
        term,
        weight,
        source
      });
      break;
    }
  }

  const historyBoost = matchHistoryBoost(talent, history, brief);
  if (historyBoost > 0) {
    score += historyBoost;
    const source = {
      type: "database",
      field: "match_history",
      value: "Recent agency match history",
      updated_at: now()
    };
    claims.push({
      claim: `${talent.name} appeared in a prior positive or used shortlist for a similar brief.`,
      source
    });
      scoreDrivers.push({
      label: "Similar approved match history",
      field: "match_history",
      term: "history",
      weight: historyBoost,
      source
    });
  }

  const preAvailabilityScore = score;
  const availabilityConflict = availabilityOverlaps(talent, requirements.availability_window || {});
  const availabilityBlocked = availabilityConflict.booked.length
    ? `Booked during requested window: ${availabilityConflict.booked.map(formatAvailabilityWindow).join("; ")}.`
    : "";
  if (availabilityConflict.booked.length) {
    const penalty = Math.min(12, availabilityConflict.booked.length * 8);
    score -= penalty;
    scoreDrivers.push({
      label: "Booked date overlap",
      field: "availability",
      term: "booked",
      weight: -penalty,
      source: {
        type: "database",
        field: "talent_availability",
        value: availabilityConflict.booked.map(formatAvailabilityWindow).join("; "),
        updated_at: availabilityConflict.booked[0]?.updated_at || talent.updated_at
      }
    });
  } else if (availabilityConflict.held.length) {
    scoreDrivers.push({
      label: "Held date overlap",
      field: "availability",
      term: "held",
      weight: -2,
      source: {
        type: "database",
        field: "talent_availability",
        value: availabilityConflict.held.map(formatAvailabilityWindow).join("; "),
        updated_at: availabilityConflict.held[0]?.updated_at || talent.updated_at
      }
    });
  }

  const uniqueClaims = dedupeClaims(claims).slice(0, 6);
  const uniqueDrivers = dedupeScoreDrivers(scoreDrivers).slice(0, 8);
  const cautions = [];
  if (!uniqueClaims.length) cautions.push("No sourced field directly matched the brief terms.");
  if (!talent.availability) cautions.push("Availability field is blank.");
  if (availabilityBlocked) cautions.push(availabilityBlocked);
  if (availabilityConflict.held.length) cautions.push(`Held during requested window: ${availabilityConflict.held.map(formatAvailabilityWindow).join("; ")}.`);

  const missingEvidence = [];
  if (!matchedTerms.has("spokesperson") && terms.includes("spokesperson")) missingEvidence.push("No direct spokesperson field match.");
  if (!matchedTerms.has("eyewear") && terms.includes("eyewear")) missingEvidence.push("No direct eyewear field match.");
  if (!matchedTerms.size) missingEvidence.push("No matching tags, notes, misc notes, availability, rate, or past bookings.");

  const rationale = uniqueClaims.length
    ? `Matched ${uniqueClaims.length} sourced roster field${uniqueClaims.length === 1 ? "" : "s"} against the brief.`
    : "Kept out of the main recommendation because the fallback matcher found no sourced evidence.";

  return { talent, score: roundScore(score), preAvailabilityScore: roundScore(preAvailabilityScore), claims: uniqueClaims, scoreDrivers: uniqueDrivers, cautions, missingEvidence, rationale, availabilityBlocked };
}

function formatAvailabilityWindow(row) {
  return `${row.status} ${row.start_date}${row.end_date && row.end_date !== row.start_date ? ` to ${row.end_date}` : ""}${row.note ? ` (${row.note})` : ""}`;
}

function sourceForTalentField(talent, field, text, term) {
  const publicSource = field === "public_sources" ? talent.public_sources?.[0] : null;
  if (publicSource) {
    return {
      type: "external",
      field,
      value: excerpt(text, term),
      url: publicSource.url,
      title: `${publicSource.provider || "Public source"}: ${publicSource.label || publicSource.item_id || talent.name}`,
      updated_at: talent.field_updated_at[field] || publicSource.retrieved_at || talent.updated_at
    };
  }
  return {
    type: "database",
    field,
    value: excerpt(text, term),
    updated_at: talent.field_updated_at[field] || talent.updated_at
  };
}

function fallbackLearningProfile(history, terms, brief) {
  const currentTerms = new Set(terms);
  const termAdjustments = {};
  const fieldAdjustments = {};

  for (const entry of history || []) {
    const signal = fallbackOutcomeSignal(entry);
    if (!signal) continue;
    const previousTerms = new Set(extractTerms(entry.brief));
    const overlap = [...currentTerms].filter((term) => previousTerms.has(term));
    if (!overlap.length) continue;
    const influence = signal * Math.min(1, overlap.length / Math.max(2, currentTerms.size));
    for (const item of entry.result?.shortlist || []) {
      const drivers = item.score_drivers?.length ? item.score_drivers : driversFromClaims(item.claims || []);
      for (const driver of drivers) {
        if (driver.field && PUBLIC_ROSTER_FIELDS.includes(driver.field)) {
          fieldAdjustments[driver.field] = (fieldAdjustments[driver.field] || 0) + influence * 0.35;
        }
        const term = String(driver.term || "").toLowerCase();
        if (term && currentTerms.has(term)) {
          termAdjustments[term] = (termAdjustments[term] || 0) + influence * 0.45;
        }
      }
    }
  }

  return {
    fieldMultipliers: Object.fromEntries(PUBLIC_ROSTER_FIELDS.map((field) => [
      field,
      roundScore(clamp(1 + (fieldAdjustments[field] || 0), 0.65, 1.75))
    ])),
    termMultipliers: Object.fromEntries([...currentTerms].map((term) => [
      term,
      roundScore(clamp(1 + (termAdjustments[term] || 0), 0.65, 1.8))
    ]))
  };
}

function fallbackOutcomeSignal(entry) {
  const text = `${entry?.outcome || ""} ${entry?.feedback || ""}`.toLowerCase();
  if (/(discard|rejected|wrong|bad|not a fit|lacked|missing)/.test(text)) return -0.75;
  if (/(approved|used|success|successful|booked|won|copy-out)/.test(text)) return 1;
  return 0;
}

function driversFromClaims(claims = []) {
  return claims.map((claim) => ({
    label: claim.claim || fieldLabel(claim.source?.field || "match"),
    field: claim.source?.field || "",
    term: "",
    weight: 0,
    source: claim.source || {}
  }));
}

function matchHistoryBoost(talent, history, brief) {
  const briefTerms = new Set(extractTerms(brief));
  let boost = 0;
  for (const entry of history) {
    const outcome = `${entry.outcome} ${entry.feedback}`.toLowerCase();
    if (!/(used|success|successful|booked|approved|won)/.test(outcome)) continue;
    const previousTerms = new Set(extractTerms(entry.brief));
    const overlap = [...briefTerms].filter((term) => previousTerms.has(term)).length;
    const appeared = (entry.result.shortlist || []).some((item) => Number(item.talent_id) === Number(talent.id) || item.name === talent.name);
    if (overlap >= 2 && appeared) boost += 5;
  }
  return boost;
}

function dedupeClaims(claims) {
  const seen = new Set();
  return claims.filter((claim) => {
    const key = `${claim.claim}|${claim.source.field}|${claim.source.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeScoreDrivers(drivers = []) {
  const seen = new Set();
  return drivers.filter((driver) => {
    const key = `${driver.field}|${driver.term}|${driver.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fieldLabel(field) {
  return field.replaceAll("_", " ");
}

function talentFieldText(talent, field) {
  if (field === "tags") return talent.tags.join(", ");
  if (field === "public_sources") return summarizePublicSources(talent.public_sources);
  if (field === "misc_notes") return summarizeMiscNotes(talent.misc_notes);
  return String(talent[field] || "");
}

function summarizeMiscNotes(notes = []) {
  return normalizeMiscNotes(notes)
    .map((item) => [item.note, item.source ? `source: ${item.source}` : "", item.date ? `date: ${item.date}` : ""].filter(Boolean).join(" | "))
    .join("\n");
}

function summarizePublicSources(sources = []) {
  return sources.map((source) => {
    const parts = [
      source.provider || source.type || "Public source",
      source.label,
      source.description,
      (source.claims?.occupations || []).join(", "),
      (source.links || []).map((link) => `${link.label}: ${link.url}`).join("; ")
    ].filter(Boolean);
    return parts.join(" | ");
  }).join("\n");
}

function wikidataSummaryForSources(sources = [], fallback = "") {
  const source = normalizePublicSources(sources).find((item) => item.provider === "Wikidata" || item.type === "wikidata") || {};
  const parts = [
    source.item_id,
    source.label,
    source.description,
    ...(source.aliases || []),
    ...(source.claims?.occupations || []),
    ...(source.claims?.nationalities || []),
    ...(source.links || []).map((link) => link.label)
  ].filter(Boolean);
  return parts.length ? dedupeLabels(parts).join(" ") : String(fallback || "").trim();
}

function occupationMatchesTag(occupation, tag) {
  const left = normalizeComparable(occupation);
  const right = normalizeComparable(tag);
  if (!left || !right) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const aliases = {
    host: ["presenter", "television presenter", "radio host", "tv host"],
    presenter: ["host", "television presenter", "tv host"],
    actor: ["actress", "film actor", "television actor", "voice actor"],
    musician: ["singer", "songwriter", "composer", "rapper"],
    model: ["fashion model"],
    creator: ["youtuber", "streamer", "content creator"],
    comedy: ["comedian", "comic"]
  };
  return (aliases[right] || []).some((alias) => left.includes(alias))
    || Object.entries(aliases).some(([canonical, values]) => values.includes(right) && left.includes(canonical));
}

function excerpt(text, term) {
  const value = String(text || "");
  const lower = value.toLowerCase();
  const index = lower.indexOf(String(term || "").toLowerCase());
  if (index < 0) return value.slice(0, 220);
  const start = Math.max(0, index - 70);
  const end = Math.min(value.length, index + String(term).length + 110);
  return `${start > 0 ? "..." : ""}${value.slice(start, end)}${end < value.length ? "..." : ""}`;
}

function normalizeMatchResult(result) {
  const normalized = result && typeof result === "object" ? result : {};
  normalized.criteria ||= { stated: [], inferred: [], ambiguous: [] };
  normalized.shortlist ||= [];
  normalized.excluded_but_close ||= [];
  normalized.workflow = normalizeCastingWorkflow(normalized.workflow);
  normalized.flags_for_reviewer = uniqueStrings(normalized.flags_for_reviewer || []);
  if (!normalized.flags_for_reviewer.some((flag) => /requires review before external use/i.test(flag))) {
    normalized.flags_for_reviewer.push("Requires review before external use.");
  }
  normalized.review_required = true;
  normalized.review_required_notice = "Requires review before external use.";

  for (const item of normalized.shortlist) {
    item.claims ||= [];
    for (const claim of item.claims) {
      claim.source ||= {};
      if (!claim.source.type) {
        claim.source.type = "database";
        normalized.flags_for_reviewer.push(`Reviewer check: claim for ${item.name || "a talent"} was missing source type.`);
      }
    }
    item.score_drivers = normalizeScoreDrivers(item.score_drivers, item.claims);
  }
  normalized.flags_for_reviewer = uniqueStrings(normalized.flags_for_reviewer);
  return normalized;
}

function normalizeCastingWorkflow(workflow = {}) {
  const source = workflow && typeof workflow === "object" ? workflow : {};
  return {
    stage: String(source.stage || "first_draft").trim(),
    data_sources: uniqueStrings(source.data_sources || source.dataSources || ["Roster"]),
    hard_filters: normalizeWorkflowFilters(source.hard_filters || source.hardFilters || [
      { filter: "Status", status: "pass", note: "Archived talent are excluded from active matching by default." },
      { filter: "Availability", status: "review", note: "Booked date overlaps are excluded; held dates are flagged for reviewer judgment." },
      { filter: "Budget", status: "review", note: "Parsed budget is compared with roster rate when available; missing or close rates stay in review." },
      { filter: "COI / exclusivity", status: "review", note: "Requires Deep Research before any client-ready shortlist." }
    ]),
    soft_rank_basis: uniqueStrings(source.soft_rank_basis || source.softRankBasis || [
      "Roster priority",
      "Sourced theme or role connection",
      "Past approved match history",
      "Availability and budget cautions"
    ]),
    verification_required: uniqueStrings(source.verification_required || source.verificationRequired || [
      "Deep Research source check",
      "Conflict-of-interest recheck",
      "Fee and exclusivity verification",
      "Consent/comfort check for sensitive personal-story pitches"
    ])
  };
}

function normalizeWorkflowFilters(filters = []) {
  return (Array.isArray(filters) ? filters : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const filter = String(item.filter || item.name || "").trim();
      if (!filter) return null;
      const status = String(item.status || "review").trim().toLowerCase();
      return {
        filter,
        status: ["pass", "review", "fail"].includes(status) ? status : "review",
        note: String(item.note || item.reason || "").trim()
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function uniqueStrings(values = []) {
  const seen = new Set();
  return (values || [])
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeScoreDrivers(drivers = [], claims = []) {
  const sourceDrivers = Array.isArray(drivers) && drivers.length ? drivers : driversFromClaims(claims);
  return sourceDrivers
    .map((driver) => {
      const source = driver?.source && typeof driver.source === "object" ? driver.source : {};
      const field = String(driver?.field || source.field || "").trim();
      const term = String(driver?.term || "").trim();
      const label = String(driver?.label || (field ? `${fieldLabel(field)} signal` : "Match signal")).trim();
      if (!label && !field && !term) return null;
      return {
        label,
        field,
        term,
        weight: roundScore(driver?.weight || 0),
        source
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

export async function searchWikidataItems(query, limit = 6, context = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const path = `/search/items?language=${encodeURIComponent(WIKIDATA_LANGUAGE)}&q=${encodeURIComponent(q)}&limit=${Math.min(Number(limit) || 6, 10)}`;
  const data = await wikidataRequest(path);
  const candidateIds = (data.results || []).map((result) => result.id).filter((id) => /^Q\d+$/.test(id));
  const summaries = new Map();
  await Promise.all(candidateIds.map(async (id) => {
    const summary = await summarizeWikidataItem(id).catch(() => null);
    if (summary?.human) summaries.set(id, summary);
  }));
  const contextTags = normalizeTags(context.tags || context.roster_tags || []);
  return (data.results || [])
    .map((result) => {
      const summary = summaries.get(result.id);
      if (!summary) return null;
      const occupationMatches = (summary.claims?.occupations || [])
        .filter((occupation) => contextTags.some((tag) => occupationMatchesTag(occupation, tag)));
      const rosterFit = occupationMatches.length ? roundConfidence(Math.min(1, 0.55 + occupationMatches.length * 0.15)) : 0;
      return {
        id: result.id,
        label: summary.label || displayTerm(result["display-label"]) || result.label || result.id,
        description: summary.description || displayTerm(result.description) || "",
        aliases: summary.aliases || [],
        occupations: summary.claims?.occupations || [],
        roster_fit: rosterFit,
        roster_fit_reasons: occupationMatches,
        match: displayTerm(result.match) || "",
        url: `https://www.wikidata.org/wiki/${result.id}`
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.roster_fit - a.roster_fit || a.label.localeCompare(b.label))
    .slice(0, Math.min(Number(limit) || 6, 10));
}

export async function getWikidataItem(itemId) {
  const id = normalizeWikidataItemId(itemId);
  return wikidataRequest(`/entities/items/${encodeURIComponent(id)}`);
}

export async function summarizeWikidataItem(itemId) {
  const item = await getWikidataItem(itemId);
  const id = normalizeWikidataItemId(item.id || itemId);
  const label = termForLanguage(item.labels, WIKIDATA_LANGUAGE) || id;
  const description = termForLanguage(item.descriptions, WIKIDATA_LANGUAGE) || "";
  const aliases = aliasesForLanguage(item.aliases, WIKIDATA_LANGUAGE).slice(0, 8);
  const instanceIds = valuesForProperty(item, "P31").filter((value) => /^Q\d+$/.test(value)).slice(0, 12);
  const occupationIds = valuesForProperty(item, "P106").filter((value) => /^Q\d+$/.test(value)).slice(0, 8);
  const occupations = [];
  for (const occupationId of occupationIds) {
    occupations.push(await getWikidataLabel(occupationId).catch(() => occupationId));
  }
  const nationalityIds = valuesForProperty(item, "P27").filter((value) => /^Q\d+$/.test(value)).slice(0, 4);
  const nationalities = [];
  for (const nationalityId of nationalityIds) {
    nationalities.push(await getWikidataLabel(nationalityId).catch(() => nationalityId));
  }

  const links = [
    ...valuesForProperty(item, "P856").map((url) => ({ label: "Official website", url })),
    ...valuesForProperty(item, "P345").map((idValue) => ({ label: "IMDb", url: `https://www.imdb.com/name/${idValue}/` })),
    ...valuesForProperty(item, "P2003").map((handle) => ({ label: "Instagram", url: `https://www.instagram.com/${handle}/` })),
    ...valuesForProperty(item, "P2002").map((handle) => ({ label: "X", url: `https://x.com/${handle}` })),
    ...valuesForProperty(item, "P2397").map((channelId) => ({ label: "YouTube", url: `https://www.youtube.com/channel/${channelId}` }))
  ].filter((link) => link.url && /^https?:\/\//.test(link.url));

  const imageFilename = valuesForProperty(item, "P18")[0];
  const image_url = imageFilename
    ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageFilename.replaceAll(" ", "_"))}`
    : "";

  return {
    provider: "Wikidata",
    type: "wikidata",
    item_id: id,
    label,
    description,
    aliases,
    url: `https://www.wikidata.org/wiki/${id}`,
    image_url,
    links,
    human: instanceIds.includes("Q5"),
    claims: { instance_of: instanceIds, occupations, nationalities },
    retrieved_at: now(),
    license: "Wikidata structured data is CC0; linked page text/media may have separate licenses."
  };
}

export async function attachWikidataToTalent(identifier, itemId, actor = null) {
  const talent = getTalent(identifier, { includeArchived: true });
  if (!talent) throw new Error("Talent not found.");
  const source = await summarizeWikidataItem(itemId);
  const publicSources = [
    source,
    ...talent.public_sources.filter((existing) => !(existing.provider === "Wikidata" || existing.type === "wikidata"))
  ];
  return patchTalent(talent.id, {
    wikidata_item_id: source.item_id,
    public_sources: publicSources
  }, "wikidata", actor).talent;
}

export async function refreshWikidataForTalent(identifier, actor = null) {
  const talent = getTalent(identifier, { includeArchived: true });
  if (!talent) throw new Error("Talent not found.");
  const itemId = talent.wikidata_item_id || talent.public_sources?.find((source) => source.item_id)?.item_id;
  if (!itemId) throw new Error("No Wikidata item is attached.");
  return attachWikidataToTalent(talent.id, itemId, actor);
}

export async function proposeWikidataRefresh(identifier, actor = null) {
  const talent = getTalent(identifier, { includeArchived: true });
  if (!talent) throw new Error("Talent not found.");
  const itemId = talent.wikidata_item_id || talent.public_sources?.find((source) => source.item_id)?.item_id;
  if (!itemId) throw new Error("No Wikidata item is attached.");
  const proposed = await summarizeWikidataItem(itemId);
  const current = talent.public_sources?.find((source) => source.provider === "Wikidata" || source.type === "wikidata") || {};
  const diff = wikidataRefreshDiff(current, proposed);
  if (!diff.length) {
    touchTalentField(talent.id, "public_sources", "wikidata_reviewed", actor);
    return null;
  }
  return createSuggestion({
    type: "wikidata_refresh_review",
    talent_id: talent.id,
    title: `Review Wikidata refresh for ${talent.name}`,
    body: diff.map((item) => `${item.field}: ${item.current || "(blank)"} -> ${item.proposed || "(blank)"}`).slice(0, 4).join("; "),
    payload: {
      default_action: "apply_wikidata_refresh",
      secondary_action: "mark_wikidata_reviewed",
      item_id: proposed.item_id,
      proposed_source: proposed,
      diff
    },
    source: "wikidata_refresh",
    confidence: 0.82
  });
}

function applyWikidataRefreshSuggestion(suggestion, actor = null) {
  const talent = getTalent(suggestion.talent_id, { includeArchived: true });
  if (!talent) throw new Error("Talent not found.");
  const proposed = suggestion.payload?.proposed_source;
  if (!proposed?.item_id) throw new Error("Refresh suggestion is missing proposed Wikidata data.");
  const publicSources = [
    proposed,
    ...talent.public_sources.filter((existing) => !(existing.provider === "Wikidata" || existing.type === "wikidata"))
  ];
  return patchTalent(talent.id, {
    wikidata_item_id: proposed.item_id,
    public_sources: publicSources
  }, "wikidata_refresh", actor).talent;
}

function wikidataRefreshDiff(current = {}, proposed = {}) {
  const fields = [
    ["label", current.label, proposed.label],
    ["description", current.description, proposed.description],
    ["aliases", (current.aliases || []).join(", "), (proposed.aliases || []).join(", ")],
    ["occupations", (current.claims?.occupations || []).join(", "), (proposed.claims?.occupations || []).join(", ")],
    ["nationalities", (current.claims?.nationalities || []).join(", "), (proposed.claims?.nationalities || []).join(", ")],
    ["image", current.image_url, proposed.image_url]
  ];
  return fields
    .filter(([, left, right]) => normalizeComparable(left) !== normalizeComparable(right))
    .map(([field, left, right]) => ({
      field,
      current: String(left || ""),
      proposed: String(right || "")
    }));
}

async function getWikidataLabel(itemId) {
  const id = normalizeWikidataItemId(itemId);
  const data = await wikidataRequest(`/entities/items/${encodeURIComponent(id)}/labels_with_language_fallback/${encodeURIComponent(WIKIDATA_LANGUAGE)}`);
  return displayTerm(data) || data.value || data.label || id;
}

async function wikidataRequest(path) {
  const url = `${WIKIDATA_REST_BASE.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = {
    accept: "application/json",
    "user-agent": WIKIDATA_USER_AGENT
  };
  if (WIKIDATA_ACCESS_TOKEN) headers.authorization = `Bearer ${WIKIDATA_ACCESS_TOKEN}`;
  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || data.error || `Wikidata request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function normalizeWikidataItemId(itemId) {
  const id = String(itemId || "").trim().toUpperCase();
  if (!/^Q\d+$/.test(id)) throw new Error("Wikidata item id must look like Q42.");
  return id;
}

function termForLanguage(terms, language) {
  if (!terms) return "";
  const term = terms[language] || terms.en || terms.mul || Object.values(terms)[0];
  return displayTerm(term);
}

function aliasesForLanguage(aliases, language) {
  if (!aliases) return [];
  const values = aliases[language] || aliases.en || aliases.mul || [];
  return Array.isArray(values) ? values.map(displayTerm).filter(Boolean) : [];
}

function displayTerm(term) {
  if (!term) return "";
  if (typeof term === "string") return term;
  if (typeof term === "object") return term.value || term.text || term.label || "";
  return String(term);
}

function valuesForProperty(item, propertyId) {
  const statements = item.statements?.[propertyId] || item.claims?.[propertyId] || [];
  return statements.map(statementValue).flat().filter(Boolean);
}

function statementValue(statement) {
  const value = statement.value?.content ?? statement.value ?? statement.mainsnak?.datavalue?.value ?? statement.datavalue?.value;
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value.id) return String(value.id);
  if (value["numeric-id"]) return `Q${value["numeric-id"]}`;
  if (value.text) return String(value.text);
  if (value.amount) return String(value.amount).replace(/^\+/, "");
  if (value.time) return String(value.time);
  return "";
}

export function closeDatabase() {
  db.close();
}
