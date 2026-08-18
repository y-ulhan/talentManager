import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import {
  ADMIN_USERNAME,
  APP_ROOT,
  CLAUDE_MODEL,
  DATABASE_PATH,
  DEFAULT_ADMIN_PASSWORD,
  UPLOADS_DIR,
  authenticate,
  addTalentMiscNote,
  addTalentAvailability,
  archiveTalent,
  attachWikidataToTalent,
  backupDatabase,
  clearTalentPhoto,
  commitImportBatch,
  createInquiryTemplate,
  createTalent,
  deleteInquiryTemplate,
  deleteTalent,
  exportCsvFile,
  findPotentialDuplicates,
  formatClientShortlistExport,
  deleteTalentAvailability,
  getImportBatch,
  listLiveSearchFindings,
  getMatchHistoryEntry,
  getTalent,
  listInquiryTemplates,
  listBackups,
  latestBackup,
  listSuggestions,
  listTalents,
  matchBrief,
  mergeDuplicateTalents,
  migrate,
  parseSpreadsheetContent,
  patchTalent,
  recentMatchHistory,
  saveTalentPhotoDataUrl,
  searchWikidataItems,
  seed,
  restoreTalent,
  resolveSuggestion,
  scanDuplicateTalents,
  stageSpreadsheetImport,
  similarTalents,
  talentsToCsv,
  usageAnalytics,
  updateHistoryFeedback
} from "./lib/talent-core.mjs";

const __filename = fileURLToPath(import.meta.url);
const PLATFORM_ROOT = dirname(__filename);
const PUBLIC_DIR = join(PLATFORM_ROOT, "public");
const PORT = Number(process.env.PORT || 4173);
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-session-secret-change-me";
const SESSION_COOKIE = "tt_platform_session";
const SESSION_TTL_SECONDS = 60 * 60 * 10;
const DAILY_BACKUP_MS = 24 * 60 * 60 * 1000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

function timingSafeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSessionCookie(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + SESSION_TTL_SECONDS * 1000
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${SESSION_COOKIE}=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(request) {
  const cookies = new Map();
  for (const part of (request.headers.cookie || "").split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key) cookies.set(key, valueParts.join("="));
  }
  return cookies;
}

function getSessionUser(request) {
  const token = parseCookies(request).get(SESSION_COOKIE);
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.exp || Date.now() > session.exp) return null;
    return { id: session.sub, username: session.username, role: session.role };
  } catch {
    return null;
  }
}

function requireUser(request, response) {
  const user = getSessionUser(request);
  if (!user) {
    sendJson(response, 401, { error: "Please log in first." });
    return null;
  }
  return user;
}

async function readBody(request, limitBytes = 12_000_000) {
  return (await readBodyBuffer(request, limitBytes)).toString("utf8");
}

async function readBodyBuffer(request, limitBytes = 30_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) throw new Error("Upload is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request);
  if (!body.trim()) return {};
  return JSON.parse(body);
}

async function readSpreadsheetUpload(request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return readJson(request);
  }

  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[1] || /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[2];
  if (!boundary) throw new Error("Spreadsheet upload is missing a multipart boundary.");
  const body = await readBodyBuffer(request);
  const parts = parseMultipartFormData(body, boundary);
  const file = parts.files.find((part) => part.name === "spreadsheet" || part.name === "file") || parts.files[0];
  if (!file) throw new Error("Upload a spreadsheet file.");
  return {
    filename: file.filename || parts.fields.filename || "upload.csv",
    base64: file.content.toString("base64")
  };
}

function parseMultipartFormData(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const files = [];
  const fields = {};
  let cursor = buffer.indexOf(delimiter);
  while (cursor >= 0) {
    cursor += delimiter.length;
    if (buffer.slice(cursor, cursor + 2).toString() === "--") break;
    if (buffer.slice(cursor, cursor + 2).toString() === "\r\n") cursor += 2;
    const next = buffer.indexOf(delimiter, cursor);
    if (next < 0) break;
    let part = buffer.slice(cursor, next);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) {
      cursor = next;
      continue;
    }
    const rawHeaders = part.slice(0, headerEnd).toString("utf8");
    const content = part.slice(headerEnd + 4);
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(rawHeaders)?.[1] || "";
    const name = /name="([^"]+)"/i.exec(disposition)?.[1] || "";
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] || "";
    if (filename) {
      files.push({ name, filename: basename(filename), content });
    } else if (name) {
      fields[name] = content.toString("utf8");
    }
    cursor = next;
  }
  return { fields, files };
}

function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(data));
}

function notFound(response) {
  sendJson(response, 404, { error: "Not found." });
}

async function handleApi(request, response, url) {
  try {
    if (request.method === "GET" && url.pathname === "/api/session") {
      sendJson(response, 200, {
        user: getSessionUser(request),
        app: {
          database_path: DATABASE_PATH,
          model: CLAUDE_MODEL,
          demo_username: ADMIN_USERNAME,
          demo_password: process.env.ADMIN_PASSWORD ? "" : DEFAULT_ADMIN_PASSWORD
        }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/login") {
      const input = await readJson(request);
      const user = authenticate(input.username, input.password);
      if (!user) {
        sendJson(response, 401, { error: "Invalid username or password." });
        return;
      }
      sendJson(response, 200, { user }, { "set-cookie": createSessionCookie(user) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/logout") {
      sendJson(response, 200, { ok: true }, { "set-cookie": clearSessionCookie() });
      return;
    }

    const user = requireUser(request, response);
    if (!user) return;

    if (request.method === "GET" && url.pathname === "/api/talents") {
      sendJson(response, 200, {
        talents: listTalents(url.searchParams.get("q") || "", {
          includeArchived: url.searchParams.get("include_archived") === "1",
          archivedOnly: url.searchParams.get("archived") === "1"
        })
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/talents") {
      const input = await readJson(request);
      if (!input.confirm_duplicate) {
        const duplicates = findPotentialDuplicates(input);
        if (duplicates.length) {
          sendJson(response, 409, {
            error: "Possible duplicate talent found. Confirm before creating a new roster record.",
            duplicates
          });
          return;
        }
      }
      const created = createTalent(input, "boss_entered", user);
      let talent = created.talent;
      if (input.photo_data_url) talent = saveTalentPhotoDataUrl(talent.id, input.photo_data_url, user);
      sendJson(response, 201, { ...created, talent });
      return;
    }

    const talentMatch = url.pathname.match(/^\/api\/talents\/([^/]+)$/);
    if (talentMatch && request.method === "GET") {
      const talent = getTalent(decodeURIComponent(talentMatch[1]), { includeArchived: url.searchParams.get("include_archived") === "1" });
      if (!talent) return notFound(response);
      sendJson(response, 200, { talent });
      return;
    }

    if (talentMatch && request.method === "PATCH") {
      const input = await readJson(request);
      const identifier = decodeURIComponent(talentMatch[1]);
      const existing = getTalent(identifier, { includeArchived: true });
      if (!existing) return notFound(response);
      if (!input.confirm_duplicate) {
        const duplicates = findPotentialDuplicates({ ...existing, ...input }, { excludeId: existing.id });
        if (duplicates.length) {
          sendJson(response, 409, {
            error: "Possible duplicate talent found. Confirm before saving this edit.",
            duplicates
          });
          return;
        }
      }
      const patched = patchTalent(identifier, input, "boss_entered", user);
      let talent = patched.talent;
      if (input.clear_photo) talent = clearTalentPhoto(talent.id, user);
      if (input.photo_data_url) talent = saveTalentPhotoDataUrl(talent.id, input.photo_data_url, user);
      sendJson(response, 200, { ...patched, talent });
      return;
    }

    if (talentMatch && request.method === "DELETE") {
      sendJson(response, 200, { archived: archiveTalent(decodeURIComponent(talentMatch[1]), user) });
      return;
    }

    const restoreTalentMatch = url.pathname.match(/^\/api\/talents\/([^/]+)\/restore$/);
    if (restoreTalentMatch && request.method === "POST") {
      sendJson(response, 200, { talent: restoreTalent(decodeURIComponent(restoreTalentMatch[1]), user) });
      return;
    }

    const talentAvailabilityMatch = url.pathname.match(/^\/api\/talents\/([^/]+)\/availability$/);
    if (talentAvailabilityMatch && request.method === "POST") {
      const entry = addTalentAvailability(decodeURIComponent(talentAvailabilityMatch[1]), await readJson(request), user);
      sendJson(response, 201, { entry, talent: getTalent(decodeURIComponent(talentAvailabilityMatch[1]), { includeArchived: true }) });
      return;
    }

    const talentAvailabilityDeleteMatch = url.pathname.match(/^\/api\/talents\/([^/]+)\/availability\/(\d+)$/);
    if (talentAvailabilityDeleteMatch && request.method === "DELETE") {
      sendJson(response, 200, {
        deleted: deleteTalentAvailability(decodeURIComponent(talentAvailabilityDeleteMatch[1]), talentAvailabilityDeleteMatch[2])
      });
      return;
    }

    const talentMiscNoteMatch = url.pathname.match(/^\/api\/talents\/([^/]+)\/misc-notes$/);
    if (talentMiscNoteMatch && request.method === "POST") {
      const input = await readJson(request);
      const result = addTalentMiscNote(decodeURIComponent(talentMiscNoteMatch[1]), input, user.username);
      sendJson(response, 200, result);
      return;
    }

    const similarTalentMatch = url.pathname.match(/^\/api\/talents\/([^/]+)\/similar$/);
    if (similarTalentMatch && request.method === "GET") {
      sendJson(response, 200, {
        talents: similarTalents(decodeURIComponent(similarTalentMatch[1]), Number(url.searchParams.get("limit") || 5))
      });
      return;
    }

    const wikidataAttachMatch = url.pathname.match(/^\/api\/talents\/([^/]+)\/wikidata$/);
    if (wikidataAttachMatch && request.method === "POST") {
      const input = await readJson(request);
      const identifier = decodeURIComponent(wikidataAttachMatch[1]);
      const existing = getTalent(identifier);
      if (!existing) return notFound(response);
      if (!input.confirm_duplicate) {
        const duplicates = findPotentialDuplicates({
          name: existing.name,
          wikidata_item_id: input.item_id
        }, { excludeId: existing.id }).filter((candidate) => candidate.type === "wikidata_entity");
        if (duplicates.length) {
          sendJson(response, 409, {
            error: "That Wikidata entity is already attached to another roster record.",
            duplicates
          });
          return;
        }
      }
      const talent = await attachWikidataToTalent(identifier, input.item_id, user);
      sendJson(response, 200, { talent });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/wikidata/search") {
      const q = url.searchParams.get("q") || "";
      const limit = Number(url.searchParams.get("limit") || 6);
      const contextTalent = url.searchParams.get("talent_id") ? getTalent(url.searchParams.get("talent_id")) : null;
      sendJson(response, 200, { results: await searchWikidataItems(q, limit, { tags: contextTalent?.tags || [] }) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/import-spreadsheet") {
      const input = await readSpreadsheetUpload(request);
      const batch = stageSpreadsheetImport(input, user);
      const result = commitImportBatch(batch.id, {}, user);
      sendJson(response, 200, {
        ...result.summary,
        batch: result.batch,
        results: result.results,
        skipped: result.skipped
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/import-spreadsheet/stage") {
      const input = await readSpreadsheetUpload(request);
      sendJson(response, 200, { batch: stageSpreadsheetImport(input, user) });
      return;
    }

    const importBatchMatch = url.pathname.match(/^\/api\/import-batches\/(\d+)$/);
    if (importBatchMatch && request.method === "GET") {
      sendJson(response, 200, { batch: getImportBatch(importBatchMatch[1]) });
      return;
    }

    const importCommitMatch = url.pathname.match(/^\/api\/import-batches\/(\d+)\/commit$/);
    if (importCommitMatch && request.method === "POST") {
      const input = await readJson(request);
      sendJson(response, 200, commitImportBatch(importCommitMatch[1], {
        mapping: input.mapping,
        confidence_threshold: input.confidence_threshold
      }, user));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/export") {
      response.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=\"talent-roster.csv\""
      });
      response.end(talentsToCsv());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/backups") {
      sendJson(response, 200, { backups: listBackups(10) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/backups") {
      const backup = backupDatabase("manual", user);
      response.writeHead(200, {
        "content-type": "application/vnd.sqlite3",
        "content-disposition": `attachment; filename="${basename(backup.filename)}"`,
        "cache-control": "no-store"
      });
      response.end(await readFile(backup.path));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/duplicates/scan") {
      sendJson(response, 200, scanDuplicateTalents());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/duplicates/merge") {
      const input = await readJson(request);
      sendJson(response, 200, mergeDuplicateTalents(input.primary_id || input.primaryId, input.secondary_id || input.secondaryId, user));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/analytics") {
      sendJson(response, 200, { analytics: usageAnalytics() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/match") {
      const input = await readJson(request);
      sendJson(response, 200, await matchBrief(input.brief, Boolean(input.enrichWeb), user));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/history") {
      sendJson(response, 200, { history: recentMatchHistory(100) });
      return;
    }

    const historyClientExportMatch = url.pathname.match(/^\/api\/history\/(\d+)\/client-export$/);
    if (historyClientExportMatch && request.method === "GET") {
      if (!getMatchHistoryEntry(historyClientExportMatch[1])) return notFound(response);
      sendJson(response, 200, { text: formatClientShortlistExport(historyClientExportMatch[1]) });
      return;
    }

    const historyLiveSearchMatch = url.pathname.match(/^\/api\/history\/(\d+)\/live-search$/);
    if (historyLiveSearchMatch && request.method === "GET") {
      if (!getMatchHistoryEntry(historyLiveSearchMatch[1])) return notFound(response);
      sendJson(response, 200, { findings: listLiveSearchFindings(historyLiveSearchMatch[1]) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/inquiry-templates") {
      sendJson(response, 200, { templates: listInquiryTemplates() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/inquiry-templates") {
      sendJson(response, 201, { template: createInquiryTemplate(await readJson(request), user) });
      return;
    }

    const templateMatch = url.pathname.match(/^\/api\/inquiry-templates\/(\d+)$/);
    if (templateMatch && request.method === "DELETE") {
      sendJson(response, 200, deleteInquiryTemplate(templateMatch[1]));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/suggestions") {
      sendJson(response, 200, { suggestions: listSuggestions(url.searchParams.get("status") || "open") });
      return;
    }

    const suggestionResolveMatch = url.pathname.match(/^\/api\/suggestions\/(\d+)\/resolve$/);
    if (suggestionResolveMatch && request.method === "POST") {
      sendJson(response, 200, {
        suggestion: await resolveSuggestion(suggestionResolveMatch[1], await readJson(request), user.username)
      });
      return;
    }

    const feedbackMatch = url.pathname.match(/^\/api\/history\/(\d+)\/feedback$/);
    if (feedbackMatch && request.method === "PATCH") {
      const updated = updateHistoryFeedback(feedbackMatch[1], await readJson(request), user);
      sendJson(response, 200, { entry: updated });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/seed") {
      sendJson(response, 200, { results: seed() });
      return;
    }

    notFound(response);
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Request failed." });
  }
}

async function serveFile(response, absolutePath, cacheControl = "public, max-age=3600") {
  try {
    const data = await readFile(absolutePath);
    response.writeHead(200, {
      "content-type": MIME_TYPES[extname(absolutePath).toLowerCase()] || "application/octet-stream",
      "cache-control": cacheControl
    });
    response.end(data);
  } catch {
    notFound(response);
  }
}

async function serveStatic(request, response, url) {
  if (url.pathname.startsWith("/uploads/")) {
    const uploadPath = normalize(resolve(APP_ROOT, url.pathname.slice(1)));
    if (!uploadPath.startsWith(UPLOADS_DIR) || !existsSync(uploadPath)) return notFound(response);
    await serveFile(response, uploadPath);
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const candidate = normalize(join(PUBLIC_DIR, pathname));
  if (!candidate.startsWith(PUBLIC_DIR)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    await serveFile(response, candidate, basename(candidate) === "index.html" ? "no-store" : "public, max-age=3600");
  } catch {
    await serveFile(response, join(PUBLIC_DIR, "index.html"), "no-store");
  }
}

function startPlatform() {
  migrate();
  scheduleBackups();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || `localhost:${PORT}`}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(request, response, url);
  });

  server.listen(PORT, () => {
    console.log(`Talent Match Terminal platform running at http://localhost:${PORT}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.log(`Demo login: ${ADMIN_USERNAME} / ${DEFAULT_ADMIN_PASSWORD}`);
    }
  });
}

function scheduleBackups() {
  const latest = latestBackup();
  const latestTime = latest?.created_at ? Date.parse(latest.created_at) : 0;
  if (!latestTime || Date.now() - latestTime > DAILY_BACKUP_MS) {
    runScheduledBackup("startup");
  }
  setInterval(() => runScheduledBackup("daily"), DAILY_BACKUP_MS).unref();
}

function runScheduledBackup(reason) {
  try {
    const backup = backupDatabase(reason);
    console.log(`Database backup created: ${backup.filename}`);
  } catch (error) {
    console.warn(`Database backup failed: ${error.message}`);
  }
}

startPlatform();
