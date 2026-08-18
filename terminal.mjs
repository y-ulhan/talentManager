import readline from "node:readline/promises";
import { readFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import {
  ADMIN_USERNAME,
  ANTHROPIC_API_KEY,
  APP_ROOT,
  CLAUDE_MODEL,
  DATABASE_PATH,
  DEFAULT_ADMIN_PASSWORD,
  authenticate,
  closeDatabase,
  createTalent,
  deleteTalent,
  exportCsvFile,
  getTalent,
  importCsvFile,
  listTalents,
  matchBrief,
  migrate,
  patchTalent,
  recentMatchHistory,
  seed,
  updateHistoryFeedback
} from "./lib/talent-core.mjs";

const helpText = `commands
  login <user> <password>
  logout
  add <name> | tags=a; b | rate=$ | notes=... | availability=... | past=...
  update <id-or-name> | tags=a; b | rate=$ | notes=... | availability=... | past=...
  import <csv-path>
  export [csv-path]
  list [search text]
  show <id-or-name>
  delete <id-or-name>
  match <client brief>
  match --web <client brief>
  history
  feedback <history-id> | outcome=used | feedback=why it worked
  seed
  clear
  help
  exit`;

let rl = null;
let currentUser = null;

async function main() {
  migrate();
  printBanner();
  if (!process.env.ADMIN_PASSWORD) {
    write(`Local demo login: ${ADMIN_USERNAME} / ${DEFAULT_ADMIN_PASSWORD}`);
  }
  if (!ANTHROPIC_API_KEY) {
    write("ANTHROPIC_API_KEY is not set; match uses the local sourced fallback.");
  }
  write(`Database: ${DATABASE_PATH}`);
  write("Type help for commands.\n");

  if (!input.isTTY) {
    const script = readFileSync(0, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of script) {
      write(`${currentUser ? `${currentUser.username}@talent:~$ ` : "guest@talent:~$ "}${sanitizeCommand(line)}`);
      const shouldExit = await runCommand(line);
      if (shouldExit) break;
    }
    closeDatabase();
    return;
  }

  rl = readline.createInterface({
    input,
    output,
    historySize: 200,
    removeHistoryDuplicates: true
  });

  while (true) {
    const prompt = currentUser ? `${currentUser.username}@talent:~$ ` : "guest@talent:~$ ";
    const line = (await rl.question(prompt)).trim();
    if (!line) continue;
    const shouldExit = await runCommand(line);
    if (shouldExit) break;
  }

  rl.close();
  closeDatabase();
}

async function runCommand(line) {
  const [commandRaw, ...restParts] = line.split(/\s+/);
  const command = commandRaw.toLowerCase();
  const rest = line.slice(commandRaw.length).trim();

  try {
    if (command === "help") {
      write(helpText);
      return false;
    }

    if (command === "exit" || command === "quit") {
      write("bye");
      return true;
    }

    if (command === "clear") {
      console.clear();
      return false;
    }

    if (command === "login") {
      const [username, ...passwordParts] = restParts;
      const password = passwordParts.join(" ");
      if (!username || !password) throw new Error("Use: login <user> <password>");
      const user = authenticate(username, password);
      if (!user) throw new Error("Invalid username or password.");
      currentUser = user;
      write(`logged in as ${currentUser.username}`);
      return false;
    }

    if (command === "logout") {
      currentUser = null;
      write("logged out");
      return false;
    }

    requireLogin();

    if (command === "add") {
      const fields = parseTalentFields(rest, false);
      const data = createTalent(fields);
      printTalent(data.talent, `${data.action}:`);
      return false;
    }

    if (command === "update" || command === "edit") {
      const fields = parseTalentFields(rest, true);
      const identifier = fields.identifier;
      delete fields.identifier;
      const data = patchTalent(identifier, fields);
      printTalent(data.talent, `${data.action}:`);
      return false;
    }

    if (command === "import") {
      const filePath = stripQuotes(rest);
      if (!filePath) throw new Error("Use: import <csv-path>");
      const data = importCsvFile(filePath);
      write(`imported ${data.imported} rows (${data.created} created, ${data.updated} updated, ${data.unchanged} unchanged)`);
      return false;
    }

    if (command === "export") {
      const outputPath = exportCsvFile(stripQuotes(rest) || "talent-roster.csv");
      write(`exported roster to ${outputPath}`);
      return false;
    }

    if (command === "list") {
      const talents = listTalents(rest);
      if (!talents.length) {
        write("no talent found");
        return false;
      }
      write(talents.map(formatTalentLine).join("\n"));
      return false;
    }

    if (command === "show") {
      if (!rest) throw new Error("Use: show <id-or-name>");
      const talent = getTalent(rest);
      if (!talent) throw new Error("Talent not found.");
      printTalent(talent);
      return false;
    }

    if (command === "delete") {
      if (!rest) throw new Error("Use: delete <id-or-name>");
      const deleted = deleteTalent(rest);
      write(`deleted ${deleted.name}`);
      return false;
    }

    if (command === "match") {
      const enrichWeb = rest.startsWith("--web");
      const brief = enrichWeb ? rest.replace(/^--web\s*/, "").trim() : rest;
      if (!brief) throw new Error("Use: match [--web] <client brief>");
      write("matching brief...");
      const data = await matchBrief(brief, enrichWeb);
      printMatch(data);
      return false;
    }

    if (command === "history") {
      const history = recentMatchHistory(100);
      if (!history.length) {
        write("no match history yet");
        return false;
      }
      write(history.map(formatHistoryLine).join("\n\n"));
      return false;
    }

    if (command === "feedback") {
      const fields = parseFeedback(rest);
      const entry = updateHistoryFeedback(fields.id, {
        outcome: fields.outcome,
        feedback: fields.feedback
      });
      write(`history #${entry.id} updated: ${entry.outcome || "no outcome"}`);
      return false;
    }

    if (command === "seed") {
      const results = seed();
      write(`seeded ${results.length} roster records`);
      return false;
    }

    throw new Error(`unknown command: ${command}`);
  } catch (error) {
    write(`error: ${error.message}`);
    return false;
  }
}

function requireLogin() {
  if (!currentUser) {
    throw new Error("Login required. Use: login admin <password>");
  }
}

function parseTalentFields(rest, firstTokenIsIdentifier) {
  const segments = rest.split("|").map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) throw new Error(firstTokenIsIdentifier ? "Use: update <id-or-name> | field=value" : "Use: add <name> | field=value");
  const result = firstTokenIsIdentifier ? { identifier: segments.shift() } : { name: segments.shift() };
  for (const segment of segments) {
    const index = segment.indexOf("=");
    if (index < 0) continue;
    const key = normalizeKey(segment.slice(0, index));
    const value = segment.slice(index + 1).trim();
    if (key === "past" || key === "pastbookings") result.past_bookings = value;
    else if (key === "tags" || key === "attributes") result.tags = value;
    else result[key] = value;
  }
  return result;
}

function parseFeedback(rest) {
  const segments = rest.split("|").map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) throw new Error("Use: feedback <history-id> | outcome=used | feedback=...");
  const result = { id: segments.shift(), outcome: "", feedback: "" };
  for (const segment of segments) {
    const index = segment.indexOf("=");
    if (index < 0) continue;
    const key = normalizeKey(segment.slice(0, index));
    const value = segment.slice(index + 1).trim();
    if (key === "outcome") result.outcome = value;
    if (key === "feedback") result.feedback = value;
  }
  return result;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function stripQuotes(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function formatTalentLine(talent) {
  return `#${talent.id} ${talent.name}
  tags: ${(talent.tags || []).join(", ") || "-"}
  rate: ${talent.rate || "-"} | availability: ${talent.availability || "-"}`;
}

function printTalent(talent, prefix = "") {
  const fieldTimes = talent.field_updated_at || {};
  write(`${prefix ? `${prefix} ` : ""}#${talent.id} ${talent.name}
tags: ${(talent.tags || []).join(", ") || "-"} [${shortTime(fieldTimes.tags)}]
rate: ${talent.rate || "-"} [${shortTime(fieldTimes.rate)}]
availability: ${talent.availability || "-"} [${shortTime(fieldTimes.availability)}]
notes: ${talent.notes || "-"} [${shortTime(fieldTimes.notes)}]
past_bookings: ${talent.past_bookings || "-"} [${shortTime(fieldTimes.past_bookings)}]`);
}

function printMatch(payload) {
  const result = payload.result;
  const lines = [];
  lines.push(`match #${payload.history_id} | ${payload.model_source} | ${payload.model_name}`);
  lines.push("");
  lines.push("criteria");
  for (const item of result.criteria?.stated || []) lines.push(`  stated: ${item.criterion}`);
  for (const item of result.criteria?.inferred || []) lines.push(`  inferred: ${item.criterion} (${item.justification})`);
  for (const item of result.criteria?.ambiguous || []) lines.push(`  ambiguous: ${item.criterion} (${item.reason})`);
  lines.push("");
  lines.push("shortlist");
  for (const item of result.shortlist || []) {
    lines.push(`  [${item.fit}] #${item.talent_id} ${item.name} | score ${item.score ?? "-"}`);
    lines.push(`    ${item.rationale || ""}`);
    for (const claim of item.claims || []) {
      const source = claim.source || {};
      const sourceText = source.type === "external"
        ? `${source.title || "external source"} ${source.url || ""}`
        : `${source.field || "database"} updated ${shortTime(source.updated_at)}`;
      lines.push(`    claim: ${claim.claim}`);
      lines.push(`      source: ${sourceText}`);
    }
    for (const caution of item.cautions || []) lines.push(`    caution: ${caution}`);
  }
  lines.push("");
  lines.push("excluded but close");
  for (const item of result.excluded_but_close || []) {
    lines.push(`  #${item.talent_id} ${item.name}: ${item.reason}`);
  }
  lines.push("");
  lines.push("flags");
  for (const flag of result.flags_for_reviewer || []) lines.push(`  ${flag}`);
  lines.push(result.review_required_notice || "Requires review before external use.");
  write(lines.join("\n"));
}

function formatHistoryLine(entry) {
  const names = (entry.result.shortlist || []).map((item) => item.name).join(", ") || "no shortlist";
  return `#${entry.id} ${shortTime(entry.created_at)} | ${entry.model_source}
  brief: ${entry.brief}
  shortlist: ${names}
  outcome: ${entry.outcome || "-"}`;
}

function shortTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function printBanner() {
  write(`
Talent Match Terminal
internal terminal platform | sourced claims | reviewer gate
Root: ${APP_ROOT}
`.trim());
}

function sanitizeCommand(line) {
  if (/^login\s+/i.test(line)) {
    const [command, username] = line.split(/\s+/);
    return `${command} ${username || ""} ********`;
  }
  return line;
}

function write(text = "") {
  output.write(`${text}\n`);
}

main().catch((error) => {
  console.error(error);
  closeDatabase();
  process.exit(1);
});
