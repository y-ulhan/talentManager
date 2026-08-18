import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { closeDatabase, previewMatchBrief } from "../lib/talent-core.mjs";

const benchmarkPath = resolve(process.argv[2] || "data/match-eval-sample.json");
const k = Number(process.argv[3] || 5);

try {
  const benchmark = JSON.parse(readFileSync(benchmarkPath, "utf8"));
  if (!Array.isArray(benchmark) || !benchmark.length) {
    throw new Error("Benchmark file must be a non-empty JSON array.");
  }

  const rows = [];
  const started = performance.now();
  for (const item of benchmark) {
    rows.push(await evaluateBrief(item, k));
  }
  const elapsedMs = performance.now() - started;
  const summary = summarize(rows, k, elapsedMs);

  console.log(JSON.stringify({ summary, rows }, null, 2));
} finally {
  closeDatabase();
}

async function evaluateBrief(item, kValue) {
  if (!item?.brief) throw new Error("Each benchmark item needs a brief.");
  const relevance = normalizeRelevance(item.relevance || item.relevant_talent_ids || item.relevantTalentIds || []);
  if (!relevance.size) throw new Error(`Benchmark item ${item.id || item.brief} has no relevance labels.`);

  const started = performance.now();
  const payload = await previewMatchBrief(item.brief, { enrichWeb: false, actor: { username: "evaluation" } });
  const latencyMs = performance.now() - started;
  const ranked = (payload.result.shortlist || []).map((candidate) => Number(candidate.talent_id)).filter(Number.isFinite);
  const topK = ranked.slice(0, kValue);

  const relevantIds = [...relevance.keys()];
  const relevantInTopK = topK.filter((id) => relevance.has(id));
  const firstRelevantRank = ranked.findIndex((id) => relevance.has(id)) + 1;
  const claims = (payload.result.shortlist || []).flatMap((candidate) => candidate.claims || []);
  const claimsWithSource = claims.filter((claim) => hasTraceableSource(claim));

  return {
    id: item.id || "",
    brief: item.brief,
    expected_relevant: relevantIds.length,
    returned: ranked.length,
    top_k_ids: topK,
    relevant_in_top_k: relevantInTopK,
    precision_at_k: divide(relevantInTopK.length, kValue),
    recall_at_k: divide(relevantInTopK.length, relevantIds.length),
    hit_at_k: relevantInTopK.length > 0 ? 1 : 0,
    reciprocal_rank: firstRelevantRank ? 1 / firstRelevantRank : 0,
    ndcg_at_k: ndcgAtK(topK, relevance, kValue),
    citation_coverage: divide(claimsWithSource.length, claims.length || 1),
    total_claims: claims.length,
    unsupported_claims: claims.length - claimsWithSource.length,
    review_flag_present: /requires review before external use/i.test(payload.result.review_required_notice || "")
      || (payload.result.flags_for_reviewer || []).some((flag) => /requires review before external use/i.test(flag)),
    latency_ms: round(latencyMs, 3),
    model_source: payload.model_source,
    model_name: payload.model_name
  };
}

function normalizeRelevance(value) {
  const map = new Map();
  if (!Array.isArray(value)) return map;
  for (const item of value) {
    if (typeof item === "number" || typeof item === "string") {
      const id = Number(item);
      if (Number.isFinite(id)) map.set(id, 1);
      continue;
    }
    const id = Number(item.talent_id ?? item.talentId ?? item.id);
    const rating = Number(item.rating ?? item.relevance ?? item.grade ?? 1);
    if (Number.isFinite(id)) map.set(id, Math.max(1, Math.min(3, rating || 1)));
  }
  return map;
}

function hasTraceableSource(claim) {
  const source = claim?.source || {};
  if (!source || typeof source !== "object") return false;
  if (source.type === "database") return Boolean(source.field);
  if (source.type === "external" || source.type === "live_search") return Boolean(source.url || source.title);
  return Boolean(source.field || source.url || source.title);
}

function ndcgAtK(topK, relevance, kValue) {
  const dcg = topK.slice(0, kValue).reduce((sum, id, index) => {
    const rating = relevance.get(id) || 0;
    return sum + gain(rating) / Math.log2(index + 2);
  }, 0);
  const idealRatings = [...relevance.values()].sort((a, b) => b - a).slice(0, kValue);
  const idcg = idealRatings.reduce((sum, rating, index) => sum + gain(rating) / Math.log2(index + 2), 0);
  return divide(dcg, idcg);
}

function gain(rating) {
  return Math.pow(2, Number(rating) || 0) - 1;
}

function summarize(rows, kValue, elapsedMs) {
  return {
    benchmark_count: rows.length,
    k: kValue,
    precision_at_k: average(rows.map((row) => row.precision_at_k)),
    recall_at_k: average(rows.map((row) => row.recall_at_k)),
    hit_at_k: average(rows.map((row) => row.hit_at_k)),
    mrr: average(rows.map((row) => row.reciprocal_rank)),
    ndcg_at_k: average(rows.map((row) => row.ndcg_at_k)),
    citation_coverage: average(rows.map((row) => row.citation_coverage)),
    unsupported_claim_rate: divide(sum(rows.map((row) => row.unsupported_claims)), sum(rows.map((row) => row.total_claims))),
    review_flag_compliance: average(rows.map((row) => row.review_flag_present ? 1 : 0)),
    avg_latency_ms: average(rows.map((row) => row.latency_ms)),
    total_elapsed_ms: round(elapsedMs, 3)
  };
}

function average(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? round(sum(clean) / clean.length, 4) : 0;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function divide(numerator, denominator) {
  const bottom = Number(denominator);
  if (!bottom) return 0;
  return round(Number(numerator) / bottom, 4);
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}
