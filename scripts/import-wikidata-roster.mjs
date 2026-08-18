import {
  WIKIDATA_USER_AGENT,
  closeDatabase,
  deleteTalent,
  importTalentRecords,
  listTalents,
  migrate
} from "../lib/talent-core.mjs";

const DEFAULT_COUNT = 500;
const DEFAULT_POOL = 1400;
const WIKIDATA_QUERY_URL = process.env.WIKIDATA_QUERY_URL || "https://query.wikidata.org/sparql";

const TALENT_OCCUPATIONS = [
  { id: "wd:Q33999", label: "actor" },
  { id: "wd:Q10800557", label: "film actor" },
  { id: "wd:Q10798782", label: "television actor" },
  { id: "wd:Q4610556", label: "model" },
  { id: "wd:Q1078132", label: "fashion model" },
  { id: "wd:Q177220", label: "singer" },
  { id: "wd:Q639669", label: "musician" },
  { id: "wd:Q2252262", label: "rapper" },
  { id: "wd:Q753110", label: "songwriter" },
  { id: "wd:Q36834", label: "composer" },
  { id: "wd:Q245068", label: "comedian" },
  { id: "wd:Q5716684", label: "dancer" },
  { id: "wd:Q947873", label: "television presenter" },
  { id: "wd:Q13590141", label: "presenter" },
  { id: "wd:Q17125263", label: "YouTuber" },
  { id: "wd:Q2066131", label: "athlete" }
];

const count = clampNumber(process.argv[2], DEFAULT_COUNT, 1, 500);
const seed = process.argv[3] || new Date().toISOString().slice(0, 10);
const poolSize = clampNumber(process.env.WIKIDATA_IMPORT_POOL, DEFAULT_POOL, count, 4000);

try {
  migrate();
  console.log(`Fetching a Wikidata talent pool (${poolSize})...`);
  const candidates = await fetchWikidataTalentPool(poolSize);
  if (candidates.length < count) {
    throw new Error(`Only found ${candidates.length} usable Wikidata records; need ${count}.`);
  }

  const selected = shuffle(candidates, seed).slice(0, count);
  console.log(`Replacing roster with ${selected.length} randomized Wikidata talents...`);
  for (const talent of listTalents()) {
    deleteTalent(talent.id);
  }
  const summary = importTalentRecords(selected);
  console.log(`Imported ${summary.imported} roster records (${summary.created} created).`);
  console.log(`Seed: ${seed}`);
  console.log("Sample:");
  for (const record of selected.slice(0, 8)) {
    console.log(`- ${record.name} (${record.wikidata_item_id}) — ${record.tags.join(", ")}`);
  }
} finally {
  closeDatabase();
}

async function fetchWikidataTalentPool(limit) {
  const perOccupation = Math.max(40, Math.ceil(limit / TALENT_OCCUPATIONS.length));
  const records = [];
  const seen = new Set();
  const seenNames = new Set();
  for (const occupation of shuffle(TALENT_OCCUPATIONS, seed)) {
    process.stdout.write(`  ${occupation.label}... `);
    const rows = await runSparql(buildTalentQuery(occupation, perOccupation));
    let added = 0;
    for (const binding of rows) {
      const record = bindingToTalentRecord(binding, occupation.label);
      const nameKey = normalizePersonName(record.name);
      if (!record.name || !record.wikidata_item_id || seen.has(record.wikidata_item_id) || seenNames.has(nameKey)) continue;
      if (record.name === record.wikidata_item_id) continue;
      seen.add(record.wikidata_item_id);
      seenNames.add(nameKey);
      records.push(record);
      added += 1;
    }
    console.log(`${added}`);
    if (records.length >= limit) break;
  }
  return records;
}

async function runSparql(query) {
  const body = new URLSearchParams({ query, format: "json" });
  const response = await fetch(WIKIDATA_QUERY_URL, {
    method: "POST",
    headers: {
      accept: "application/sparql-results+json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": WIKIDATA_USER_AGENT
    },
    body
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Wikidata Query Service failed with HTTP ${response.status}`);
  }
  return data.results?.bindings || [];
}

function buildTalentQuery(occupation, limit) {
  return `
SELECT ?person ?personLabel ?personDescription ?image
WHERE {
  ?person wdt:P31 wd:Q5;
          wdt:P106 ${occupation.id};
          rdfs:label ?personLabel.
  FILTER(LANG(?personLabel) = "en")
  OPTIONAL {
    ?person schema:description ?personDescription.
    FILTER(LANG(?personDescription) = "en")
  }
  OPTIONAL { ?person wdt:P18 ?image. }
}
LIMIT ${Number(limit)}
`.trim();
}

function bindingToTalentRecord(binding, fallbackOccupation = "") {
  const itemId = wikidataId(binding.person?.value);
  const label = binding.personLabel?.value || itemId;
  const description = binding.personDescription?.value || "";
  const occupations = splitOccupations(fallbackOccupation);
  const links = [];
  const imageUrl = binding.image?.value || "";
  const tags = [...new Set([
    ...occupations.map((occupation) => occupation.toLowerCase()),
    "wikidata",
    "public figure"
  ])].slice(0, 12);

  return {
    name: label,
    tags,
    rate: "",
    notes: [
      description ? `Wikidata description: ${description}` : "",
      occupations.length ? `Wikidata occupations: ${occupations.join(", ")}` : "",
      "Imported from Wikidata public structured data; review before external use."
    ].filter(Boolean).join("\n"),
    availability: "",
    past_bookings: "",
    wikidata_item_id: itemId,
    public_sources: [{
      provider: "Wikidata",
      type: "wikidata",
      item_id: itemId,
      label,
      description,
      aliases: [],
      url: `https://www.wikidata.org/wiki/${itemId}`,
      image_url: imageUrl,
      links,
      claims: { occupations },
      retrieved_at: new Date().toISOString(),
      license: "Wikidata structured data is CC0; linked page text/media may have separate licenses."
    }]
  };
}

function splitOccupations(value = "") {
  return [...new Set(String(value).split("|").map((item) => item.trim()).filter(Boolean))].slice(0, 8);
}

function wikidataId(uri = "") {
  const match = String(uri).match(/\/(Q\d+)$/);
  return match ? match[1] : "";
}

function normalizePersonName(name = "") {
  return String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function shuffle(items, seed) {
  const output = [...items];
  let state = hashSeed(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = nextRandom(state);
    const swapIndex = state % (index + 1);
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextRandom(state) {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}
