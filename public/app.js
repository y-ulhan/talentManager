const state = {
  user: null,
  talents: [],
  history: [],
  suggestions: [],
  templates: [],
  analytics: null,
  activeScreen: "roster",
  activeTag: "",
  selectedHistoryId: null,
  currentMatch: null,
  importBatch: null,
  demoLogin: null,
  showArchived: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const loginGate = $("#loginGate");
const appShell = $("#appShell");
const loginForm = $("#loginForm");
const loginUsername = $("#loginUsername");
const loginPassword = $("#loginPassword");
const demoLogin = $("#demoLogin");
const userBadge = $("#userBadge");
const logoutButton = $("#logoutButton");
const screenKicker = $("#screenKicker");
const screenTitle = $("#screenTitle");
const screenFraming = $("#screenFraming");
const rosterSearch = $("#rosterSearch");
const tagFilters = $("#tagFilters");
const rosterGrid = $("#rosterGrid");
const addTalentButton = $("#addTalentButton");
const uploadButton = $("#uploadButton");
const showArchivedToggle = $("#showArchivedToggle");
const spreadsheetInput = $("#spreadsheetInput");
const importDialog = $("#importDialog");
const importTitle = $("#importTitle");
const importSummary = $("#importSummary");
const importMapping = $("#importMapping");
const importRows = $("#importRows");
const closeImportDialog = $("#closeImportDialog");
const cancelImportButton = $("#cancelImportButton");
const commitImportButton = $("#commitImportButton");
const talentDialog = $("#talentDialog");
const talentForm = $("#talentForm");
const talentDialogTitle = $("#talentDialogTitle");
const closeTalentDialog = $("#closeTalentDialog");
const deleteTalentButton = $("#deleteTalentButton");
const restoreTalentButton = $("#restoreTalentButton");
const fieldProvenance = $("#fieldProvenance");
const talentRateHistory = $("#talentRateHistory");
const talentMiscNotes = $("#talentMiscNotes");
const talentAvailabilityWindows = $("#talentAvailabilityWindows");
const availabilityStatus = $("#availabilityStatus");
const availabilityStart = $("#availabilityStart");
const availabilityEnd = $("#availabilityEnd");
const availabilityNote = $("#availabilityNote");
const addAvailabilityButton = $("#addAvailabilityButton");
const wikidataQuery = $("#wikidataQuery");
const wikidataSearchButton = $("#wikidataSearchButton");
const wikidataResults = $("#wikidataResults");
const publicSources = $("#publicSources");
const matchForm = $("#matchForm");
const templateSelect = $("#templateSelect");
const saveTemplateButton = $("#saveTemplateButton");
const deleteTemplateButton = $("#deleteTemplateButton");
const briefInput = $("#briefInput");
const webEnrichment = $("#webEnrichment");
const matchResults = $("#matchResults");
const historyList = $("#historyList");
const historyDetail = $("#historyDetail");
const suggestionsList = $("#suggestionsList");
const refreshSuggestionsButton = $("#refreshSuggestionsButton");
const analyticsPanel = $("#analyticsPanel");
const settingsUser = $("#settingsUser");
const settingsExportButton = $("#settingsExportButton");
const settingsBackupButton = $("#settingsBackupButton");
const scanDuplicatesButton = $("#scanDuplicatesButton");
const similarTalentsBox = $("#similarTalents");
const toast = $("#toast");
let rosterSearchTimer = null;

const IMPORT_TARGET_OPTIONS = [
  ["name", "Name"],
  ["tags", "Tags / attributes"],
  ["rate", "Rate"],
  ["notes", "Notes"],
  ["misc_notes", "Misc timeline"],
  ["availability", "Availability"],
  ["past_bookings", "Past bookings"],
  ["photo_path", "Photo URL / path"],
  ["wikidata_item_id", "Wikidata ID"],
  ["label_source", "Extract safe labels"],
  ["needs_mapping", "Needs mapping"],
  ["sensitive_ignore", "Ignore sensitive field"],
  ["ignore", "Ignore"]
];

const screenCopy = {
  roster: {
    kicker: "Roster + ArchiveDB",
    title: "Active talent, with history retained.",
    framing: "Search the represented roster first. Archived records stay out of active casting by default, but remain available for history, dedupe, and review."
  },
  match: {
    kicker: "Campaign brief",
    title: "Brief to verified shortlist.",
    framing: "Parse the brief, query roster evidence, apply hard filters, soft-rank survivors, and prepare a sourced First Draft for Deep Research."
  },
  history: {
    kicker: "Search log",
    title: "Every campaign brief and shortlist.",
    framing: "Reopen past First Drafts, reviewer decisions, structured requirements, and copied client-ready outputs."
  },
  suggestions: {
    kicker: "Research queue",
    title: "Resolve conflicts before pitching.",
    framing: "Review import conflicts, duplicate candidates, source-backed notes, stale fields, and risk/COI maintenance in one place."
  },
  analytics: {
    kicker: "Analytics",
    title: "Casting signals over time.",
    framing: "Read-only patterns from search logs, reviewer outcomes, structured requirements, and shortlist decisions."
  },
  settings: {
    kicker: "Settings",
    title: "Keep the platform under your control.",
    framing: "Manage the Phase 1 login shape and export your roster whenever you need a backup."
  }
};

init();

async function init() {
  bindEvents();
  const session = await api("/api/session", { allowUnauthorized: true }).catch(() => ({ user: null }));
  state.user = session.user;
  state.demoLogin = session.app || null;
  if (state.demoLogin?.demo_username) loginUsername.value = state.demoLogin.demo_username;
  if (state.demoLogin?.demo_password) {
    demoLogin.textContent = `Demo login: ${state.demoLogin.demo_username} / ${state.demoLogin.demo_password}`;
  }
  syncAuth();
  if (state.user) await hydrate();
}

function bindEvents() {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: { username: loginUsername.value, password: loginPassword.value }
      });
      state.user = data.user;
      loginPassword.value = "";
      syncAuth();
      await hydrate();
      showToast("Signed in.");
    } catch (error) {
      showToast(error.message);
    }
  });

  logoutButton.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state.user = null;
    syncAuth();
  });

  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showScreen(button.dataset.screen));
  });

  rosterSearch.addEventListener("input", scheduleRosterSearch);
  addTalentButton.addEventListener("click", () => openTalentDialog());
  uploadButton.addEventListener("click", () => spreadsheetInput.click());
  showArchivedToggle.addEventListener("change", () => {
    state.showArchived = showArchivedToggle.checked;
    loadTalents().catch((error) => showToast(error.message));
  });
  settingsExportButton.addEventListener("click", exportRoster);
  settingsBackupButton.addEventListener("click", exportDatabaseBackup);
  scanDuplicatesButton.addEventListener("click", scanDuplicates);
  closeTalentDialog.addEventListener("click", () => talentDialog.close());
  deleteTalentButton.addEventListener("click", deleteCurrentTalent);
  restoreTalentButton.addEventListener("click", restoreCurrentTalent);
  addAvailabilityButton.addEventListener("click", addAvailabilityWindow);
  talentForm.addEventListener("submit", saveTalent);
  wikidataSearchButton.addEventListener("click", searchWikidataForTalent);
  spreadsheetInput.addEventListener("change", importSpreadsheet);
  refreshSuggestionsButton.addEventListener("click", loadSuggestions);
  closeImportDialog.addEventListener("click", () => importDialog.close());
  cancelImportButton.addEventListener("click", () => importDialog.close());
  commitImportButton.addEventListener("click", commitImportBatch);
  matchForm.addEventListener("submit", runMatch);
  templateSelect.addEventListener("change", applySelectedTemplate);
  saveTemplateButton.addEventListener("click", saveInquiryTemplate);
  deleteTemplateButton.addEventListener("click", deleteSelectedTemplate);
}

async function hydrate() {
  await Promise.all([loadTalents(), loadHistory(), loadSuggestions(), loadTemplates(), loadAnalytics()]);
  showScreen(state.activeScreen);
}

function syncAuth() {
  loginGate.hidden = Boolean(state.user);
  appShell.hidden = !state.user;
  if (state.user) {
    userBadge.textContent = `${state.user.username} · ${state.user.role}`;
    settingsUser.textContent = `${state.user.username} is signed in. Only the boss account is enabled in Phase 1.`;
  }
}

function showScreen(screen) {
  state.activeScreen = screen;
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.screen === screen));
  $$(".screen").forEach((section) => section.classList.toggle("active", section.id === `${screen}Screen`));
  const copy = screenCopy[screen];
  screenKicker.textContent = copy.kicker;
  screenTitle.textContent = copy.title;
  screenFraming.textContent = copy.framing;
  if (screen === "history") renderHistory();
  if (screen === "suggestions") renderSuggestions();
  if (screen === "analytics") {
    loadAnalytics().catch((error) => showToast(error.message));
    renderAnalytics();
  }
}

async function loadTalents() {
  const q = rosterSearch.value.trim();
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (state.showArchived) params.set("include_archived", "1");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = await api(`/api/talents${suffix}`);
  state.talents = data.talents;
  renderRoster();
}

async function loadHistory() {
  const data = await api("/api/history");
  state.history = data.history;
  renderHistory();
}

async function loadSuggestions() {
  const data = await api("/api/suggestions");
  state.suggestions = data.suggestions;
  renderSuggestions();
}

async function loadTemplates() {
  const data = await api("/api/inquiry-templates");
  state.templates = data.templates;
  renderTemplates();
}

async function loadAnalytics() {
  const data = await api("/api/analytics");
  state.analytics = data.analytics;
  renderAnalytics();
}

function renderTemplates() {
  const current = templateSelect.value;
  templateSelect.innerHTML = [
    `<option value="">Saved templates</option>`,
    ...state.templates.map((template) => `<option value="${template.id}">${escapeHtml(template.title)}</option>`)
  ].join("");
  if (state.templates.some((template) => String(template.id) === String(current))) {
    templateSelect.value = current;
  }
  deleteTemplateButton.disabled = !templateSelect.value;
}

function applySelectedTemplate() {
  const template = state.templates.find((item) => String(item.id) === String(templateSelect.value));
  deleteTemplateButton.disabled = !template;
  if (!template) return;
  briefInput.value = template.brief;
  briefInput.focus();
}

async function saveInquiryTemplate() {
  const brief = briefInput.value.trim();
  if (!brief) {
    showToast("Add a client request before saving a template.");
    return;
  }
  const title = window.prompt("Template name", templateTitleFromBrief(brief));
  if (title === null) return;
  try {
    const data = await api("/api/inquiry-templates", {
      method: "POST",
      body: { title: title.trim(), brief }
    });
    await loadTemplates();
    templateSelect.value = String(data.template.id);
    deleteTemplateButton.disabled = false;
    showToast("Template saved.");
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteSelectedTemplate() {
  const template = state.templates.find((item) => String(item.id) === String(templateSelect.value));
  if (!template) return;
  if (!window.confirm(`Delete template "${template.title}"?`)) return;
  await api(`/api/inquiry-templates/${encodeURIComponent(template.id)}`, { method: "DELETE" });
  templateSelect.value = "";
  await loadTemplates();
  showToast("Template deleted.");
}

function templateTitleFromBrief(brief) {
  return String(brief || "")
    .split(/[.,\n]/)[0]
    .trim()
    .slice(0, 48) || "Recurring request";
}

function scheduleRosterSearch() {
  window.clearTimeout(rosterSearchTimer);
  rosterSearchTimer = window.setTimeout(() => {
    loadTalents().catch((error) => showToast(error.message));
  }, 180);
}

function renderRoster() {
  const query = rosterSearch.value.trim().toLowerCase();
  const allTags = [...new Set(state.talents.flatMap((talent) => talent.tags || []))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 18);

  tagFilters.innerHTML = [
    `<button class="tag-chip ${state.activeTag ? "" : "active"}" data-tag="">all</button>`,
    ...allTags.map((tag) => `<button class="tag-chip ${state.activeTag === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`)
  ].join("");
  $$(".tag-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.activeTag = chip.dataset.tag;
      renderRoster();
    });
  });

  const filtered = state.talents.filter((talent) => {
    const tagMatch = !state.activeTag || (talent.tags || []).includes(state.activeTag);
    return tagMatch;
  });

  rosterGrid.innerHTML = filtered.map(renderTalentCard).join("") || emptyState("No talent found.", "Try a different tag or add someone new.");
  $$(".talent-card").forEach((card) => {
    card.addEventListener("click", () => {
      const talent = state.talents.find((item) => String(item.id) === card.dataset.id);
      openTalentDialog(talent);
    });
  });
}

function renderTalentCard(talent) {
  return `
    <article class="talent-card" data-id="${talent.id}" tabindex="0">
      ${renderPhoto(talent)}
      <div class="talent-body">
        <div class="talent-title">
          <h3>${escapeHtml(talent.name)}</h3>
          <span class="rate">${escapeHtml(talent.rate || "rate TBD")}</span>
        </div>
        ${talent.archived_at ? `<p class="archive-label">Archived ${escapeHtml(shortDate(talent.archived_at))}</p>` : ""}
        <div class="tags">${(talent.tags || []).slice(0, 5).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") || "<span>untagged</span>"}</div>
        ${renderSearchMatches(talent)}
        ${(talent.public_sources || []).length ? `<p class="meta">Public source attached: ${escapeHtml((talent.public_sources[0].provider || "source"))}</p>` : ""}
        <p class="meta">${escapeHtml(talent.availability || "Availability not set")}</p>
      </div>
    </article>
  `;
}

function renderSearchMatches(talent) {
  if (!talent.search_matches?.length) return "";
  return `
    <div class="match-reasons">
      ${talent.search_matches.slice(0, 3).map((match) => `
        <span class="${match.source === "wikidata_enrichment" ? "wikidata" : "roster"}" title="${escapeHtml(match.excerpt || "")}">
          matched: ${escapeHtml(match.label || match.field)}
        </span>
      `).join("")}
    </div>
  `;
}

function renderPhoto(talent) {
  if (talent?.photo_url) {
    return `<div class="talent-photo"><img src="${escapeHtml(talent.photo_url)}" alt="${escapeHtml(talent.name)}"></div>`;
  }
  const wikidataImage = (talent?.public_sources || []).find((source) => source.image_url)?.image_url;
  if (wikidataImage) {
    return `<div class="talent-photo"><img src="${escapeHtml(wikidataImage)}" alt="${escapeHtml(talent.name)}"></div>`;
  }
  return `<div class="talent-photo" aria-hidden="true">${initials(talent?.name || "?")}</div>`;
}

function openTalentDialog(talent = null) {
  talentForm.reset();
  $("#talentId").value = talent?.id || "";
  $("#talentName").value = talent?.name || "";
  $("#talentTags").value = (talent?.tags || []).join(", ");
  $("#talentRate").value = talent?.rate || "";
  $("#talentAvailability").value = talent?.availability || "";
  $("#talentNotes").value = talent?.notes || "";
  $("#talentPast").value = talent?.past_bookings || "";
  renderFieldProvenance(talent);
  renderRateHistory(talent?.rate_history || []);
  renderAvailabilityWindows(talent?.availability_windows || [], talent?.id);
  renderSimilarTalents([]);
  if (talent?.id && !talent.archived_at) loadSimilarTalents(talent.id).catch(() => renderSimilarTalents([]));
  renderTalentMiscNotes(talent?.misc_notes || []);
  availabilityStatus.value = "held";
  availabilityStart.value = "";
  availabilityEnd.value = "";
  availabilityNote.value = "";
  $("#clearPhoto").checked = false;
  wikidataQuery.value = talent?.name || "";
  wikidataResults.innerHTML = talent ? "" : `<p class="meta">Save the talent first, then attach a Wikidata profile if one exists.</p>`;
  renderPublicSources(talent?.public_sources || []);
  talentDialogTitle.textContent = talent ? `Edit ${talent.name}` : "Add talent";
  deleteTalentButton.hidden = !talent;
  restoreTalentButton.hidden = !talent?.archived_at;
  deleteTalentButton.textContent = talent?.archived_at ? "Archived" : "Archive";
  deleteTalentButton.disabled = Boolean(talent?.archived_at);
  addAvailabilityButton.disabled = !talent || Boolean(talent?.archived_at);
  talentDialog.showModal();
}

function renderTalentMiscNotes(notes = []) {
  talentMiscNotes.innerHTML = notes.length
    ? notes.map((item) => `
      <article class="misc-note-item">
        <p>${escapeHtml(item.note)}</p>
        <span>${escapeHtml(item.source || "manual")} ${item.match_id ? `· match #${escapeHtml(item.match_id)}` : ""} ${item.added_by ? `· ${escapeHtml(item.added_by)}` : ""} ${item.date ? `· ${escapeHtml(shortDate(item.date))}` : ""}</span>
      </article>
    `).join("")
    : `<p class="meta">No misc notes yet.</p>`;
}

function renderRateHistory(items = []) {
  talentRateHistory.innerHTML = items.length
    ? items.slice(0, 6).map((item) => `
      <article class="rate-history-item">
        <strong>${escapeHtml(item.new_rate || "rate cleared")}</strong>
        <span>${escapeHtml(item.old_rate ? `from ${item.old_rate}` : "initial rate")} - ${escapeHtml(item.source || "unknown")} - ${escapeHtml(shortDate(item.created_at))}</span>
      </article>
    `).join("")
    : `<p class="meta">No rate changes recorded yet.</p>`;
}

function renderAvailabilityWindows(items = [], talentId = "") {
  talentAvailabilityWindows.innerHTML = items.length
    ? items.map((item) => `
      <article class="availability-item">
        <div>
          <strong>${escapeHtml(item.status)} ${escapeHtml(item.start_date)}${item.end_date !== item.start_date ? ` to ${escapeHtml(item.end_date)}` : ""}</strong>
          ${item.note ? `<span>${escapeHtml(item.note)}</span>` : ""}
        </div>
        <button class="secondary" type="button" data-availability-delete="${escapeHtml(item.id)}" data-talent-id="${escapeHtml(talentId)}">Remove</button>
      </article>
    `).join("")
    : `<p class="meta">No holds or bookings.</p>`;
  talentAvailabilityWindows.querySelectorAll("[data-availability-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteAvailabilityWindow(button.dataset.talentId, button.dataset.availabilityDelete));
  });
}

async function loadSimilarTalents(talentId) {
  similarTalentsBox.innerHTML = `<p class="meta">Finding nearby roster options...</p>`;
  const data = await api(`/api/talents/${encodeURIComponent(talentId)}/similar`);
  renderSimilarTalents(data.talents || []);
}

function renderSimilarTalents(items = []) {
  similarTalentsBox.innerHTML = items.length
    ? items.map((item) => `
      <button class="similar-item" type="button" data-similar-id="${escapeHtml(item.id)}">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.reason || "Similar profile")}</span>
      </button>
    `).join("")
    : `<p class="meta">Not enough nearby profile data yet.</p>`;
  similarTalentsBox.querySelectorAll("[data-similar-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const talent = state.talents.find((item) => Number(item.id) === Number(button.dataset.similarId));
      if (talent) openTalentDialog(talent);
    });
  });
}

function renderFieldProvenance(talent) {
  if (!talent) {
    fieldProvenance.innerHTML = "";
    return;
  }
  const fields = [
    ["tags", "Tags"],
    ["rate", "Rate"],
    ["notes", "Notes"],
    ["misc_notes", "Misc"],
    ["availability", "Availability"],
    ["past_bookings", "Past"]
  ];
  fieldProvenance.innerHTML = fields.map(([field, label]) => `
    <span title="${escapeHtml(label)} source">
      ${escapeHtml(label)}: ${escapeHtml(talent.field_source?.[field] || "unknown")} · ${escapeHtml(shortDate(talent.field_updated_at?.[field] || talent.updated_at))}
    </span>
  `).join("");
}

async function saveTalent(event) {
  event.preventDefault();
  await submitTalentForm(false);
}

async function submitTalentForm(confirmedDuplicate) {
  const id = $("#talentId").value;
  const photoFile = $("#talentPhoto").files[0];
  const body = {
    name: $("#talentName").value,
    tags: $("#talentTags").value,
    rate: $("#talentRate").value,
    availability: $("#talentAvailability").value,
    notes: $("#talentNotes").value,
    past_bookings: $("#talentPast").value,
    clear_photo: $("#clearPhoto").checked
  };
  if (confirmedDuplicate) body.confirm_duplicate = true;
  if (photoFile) body.photo_data_url = await fileToDataUrl(photoFile);
  try {
    await api(id ? `/api/talents/${encodeURIComponent(id)}` : "/api/talents", {
      method: id ? "PATCH" : "POST",
      body
    });
    talentDialog.close();
    await Promise.all([loadTalents(), loadSuggestions()]);
    showToast(id ? "Talent updated." : "Talent added.");
  } catch (error) {
    if (error.status === 409 && error.data?.duplicates?.length) {
      const summary = error.data.duplicates
        .map((item) => `${item.name} (${percent(item.confidence)} ${item.type.replaceAll("_", " ")})`)
        .join("\n");
      if (window.confirm(`${error.message}\n\n${summary}\n\nCreate or save anyway?`)) {
        await submitTalentForm(true);
      }
      return;
    }
    showToast(error.message);
  }
}

async function searchWikidataForTalent() {
  const id = $("#talentId").value;
  const query = wikidataQuery.value.trim() || $("#talentName").value.trim();
  if (!id) {
    wikidataResults.innerHTML = `<p class="meta">Save this talent before attaching a public profile.</p>`;
    return;
  }
  if (!query) {
    wikidataResults.innerHTML = `<p class="meta">Enter a name to search.</p>`;
    return;
  }
  wikidataResults.innerHTML = `<p class="meta">Searching Wikidata...</p>`;
  try {
    const data = await api(`/api/wikidata/search?q=${encodeURIComponent(query)}&limit=8&talent_id=${encodeURIComponent(id)}`);
    wikidataResults.innerHTML = data.results.map((result) => `
      <div class="wikidata-result">
        <div>
          <strong>${escapeHtml(result.label)} <span>${escapeHtml(result.id)}</span></strong>
          <span>${escapeHtml(result.description || "No description")}</span>
          <span>${escapeHtml((result.occupations || []).slice(0, 5).join(", ") || "No occupation listed")}</span>
          ${result.roster_fit_reasons?.length ? `<span class="candidate-fit">Roster tag fit: ${escapeHtml(result.roster_fit_reasons.join(", "))}</span>` : ""}
        </div>
        <button type="button" data-wikidata-id="${escapeHtml(result.id)}">Attach</button>
      </div>
    `).join("") || `<p class="meta">No human Wikidata result found. Try adding an occupation or middle initial.</p>`;
    wikidataResults.querySelectorAll("[data-wikidata-id]").forEach((button) => {
      button.addEventListener("click", () => attachWikidataProfile(button.dataset.wikidataId));
    });
  } catch (error) {
    wikidataResults.innerHTML = `<p class="meta">${escapeHtml(error.message)}</p>`;
  }
}

async function attachWikidataProfile(itemId, confirmedDuplicate = false) {
  const id = $("#talentId").value;
  try {
    const data = await api(`/api/talents/${encodeURIComponent(id)}/wikidata`, {
      method: "POST",
      body: { item_id: itemId, confirm_duplicate: confirmedDuplicate }
    });
    const index = state.talents.findIndex((talent) => Number(talent.id) === Number(data.talent.id));
    if (index >= 0) state.talents[index] = data.talent;
    renderPublicSources(data.talent.public_sources || []);
    renderRoster();
    showToast(`Attached ${itemId} as a public source.`);
  } catch (error) {
    if (error.status === 409 && error.data?.duplicates?.length) {
      const summary = error.data.duplicates.map((item) => item.name).join(", ");
      if (window.confirm(`${error.message}\n\nExisting record: ${summary}\n\nAttach anyway?`)) {
        await attachWikidataProfile(itemId, true);
      }
      return;
    }
    showToast(error.message);
  }
}

function renderPublicSources(sources = []) {
  publicSources.innerHTML = sources.map((source) => `
    <div class="public-source">
      <div>
        <strong>${escapeHtml(source.provider || "Public source")}: ${escapeHtml(source.label || source.item_id || "")}</strong>
        <span>${escapeHtml(source.description || "")}</span>
        <span>${escapeHtml((source.claims?.occupations || []).join(", "))}</span>
      </div>
      <a href="${escapeHtml(source.url || "#")}" target="_blank" rel="noreferrer">Open</a>
    </div>
  `).join("") || `<p class="meta">No public profile attached.</p>`;
}

async function deleteCurrentTalent() {
  const id = $("#talentId").value;
  if (!id) return;
  if (!window.confirm("Archive this talent? They will leave active roster search and matching, but history stays intact.")) return;
  await api(`/api/talents/${encodeURIComponent(id)}`, { method: "DELETE" });
  talentDialog.close();
  await loadTalents();
  showToast("Talent archived.");
}

async function restoreCurrentTalent() {
  const id = $("#talentId").value;
  if (!id) return;
  const data = await api(`/api/talents/${encodeURIComponent(id)}/restore`, { method: "POST" });
  const index = state.talents.findIndex((talent) => Number(talent.id) === Number(data.talent.id));
  if (index >= 0) state.talents[index] = data.talent;
  talentDialog.close();
  await loadTalents();
  showToast("Talent restored.");
}

async function addAvailabilityWindow() {
  const id = $("#talentId").value;
  if (!id) {
    showToast("Save the talent before adding holds or bookings.");
    return;
  }
  const body = {
    status: availabilityStatus.value,
    start_date: availabilityStart.value,
    end_date: availabilityEnd.value || availabilityStart.value,
    note: availabilityNote.value
  };
  try {
    const data = await api(`/api/talents/${encodeURIComponent(id)}/availability`, { method: "POST", body });
    updateTalentInState(data.talent);
    renderAvailabilityWindows(data.talent.availability_windows || [], data.talent.id);
    availabilityStart.value = "";
    availabilityEnd.value = "";
    availabilityNote.value = "";
    showToast("Availability row added.");
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteAvailabilityWindow(talentId, availabilityId) {
  await api(`/api/talents/${encodeURIComponent(talentId)}/availability/${encodeURIComponent(availabilityId)}`, { method: "DELETE" });
  const data = await api(`/api/talents/${encodeURIComponent(talentId)}?include_archived=1`);
  updateTalentInState(data.talent);
  renderAvailabilityWindows(data.talent.availability_windows || [], data.talent.id);
  showToast("Availability row removed.");
}

function updateTalentInState(talent) {
  const index = state.talents.findIndex((item) => Number(item.id) === Number(talent.id));
  if (index >= 0) state.talents[index] = talent;
  else state.talents.push(talent);
  renderRoster();
}

async function importSpreadsheet() {
  const file = spreadsheetInput.files?.[0];
  spreadsheetInput.value = "";
  if (!file) return;
  const body = new FormData();
  body.append("spreadsheet", file, file.name);
  showToast("Reading spreadsheet...");
  try {
    const result = await api("/api/import-spreadsheet/stage", { method: "POST", body });
    state.importBatch = result.batch;
    await loadSuggestions();
    renderImportReview();
    importDialog.showModal();
    const summary = result.batch.summary || {};
    showToast(`Staged ${summary.rows_seen || 0} rows for review.`);
  } catch (error) {
    showToast(error.message);
  }
}

function renderImportReview() {
  const batch = state.importBatch;
  if (!batch) return;
  const summary = batch.summary || {};
  const counts = summary.status_counts || summary.final_status_counts || {};
  const committed = Number(summary.committed || 0);
  const skipped = Number(summary.skipped || 0);
  importTitle.textContent = batch.status === "committed"
    ? `Import complete: ${batch.filename}`
    : `Review before saving: ${batch.filename}`;
  commitImportButton.disabled = batch.status === "committed";
  commitImportButton.textContent = batch.status === "committed" ? "Committed" : "Commit safe rows";
  importSummary.innerHTML = [
    renderImportStat("Rows", summary.rows_seen ?? batch.rows.length),
    renderImportStat("New", summary.new ?? counts.new ?? 0),
    renderImportStat("Safe updates", summary.safe_updates ?? counts.safe_update ?? 0),
    renderImportStat("Conflicts", summary.conflicts ?? counts.conflict ?? 0),
    renderImportStat("Needs review", summary.needs_review ?? counts.needs_review ?? 0),
    renderImportStat("Errors", summary.errors ?? counts.error ?? 0),
    renderImportStat("Committed", committed),
    renderImportStat("Skipped", skipped),
    renderImportStat("Avg confidence", percent(summary.average_confidence ?? averageConfidence(batch.rows)))
  ].join("");
  renderImportMapping();
  renderImportRows();
}

function renderImportStat(label, value) {
  return `
    <div class="import-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderImportMapping() {
  const mapping = state.importBatch?.proposed_mapping || [];
  importMapping.innerHTML = mapping.map((entry) => {
    const target = entry.target || "ignore";
    const locked = target === "sensitive_ignore";
    return `
      <div class="mapping-row">
        <div>
          <strong>${escapeHtml(entry.header || `Column ${entry.index + 1}`)}</strong>
          <span>${escapeHtml(entry.reason || "")}</span>
        </div>
        <label>
          Maps to
          <select data-map-index="${entry.index}" ${locked ? "disabled" : ""}>
            ${renderImportTargetOptions(target)}
          </select>
        </label>
        <span class="mapping-confidence">${percent(entry.confidence)}</span>
      </div>
    `;
  }).join("") || `<p class="meta">No columns found.</p>`;
}

function renderImportTargetOptions(selected) {
  return IMPORT_TARGET_OPTIONS.map(([value, label]) => (
    `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`
  )).join("");
}

function renderImportRows() {
  const rows = state.importBatch?.rows || [];
  const visibleRows = rows.slice(0, 120);
  importRows.innerHTML = visibleRows.map(renderImportRow).join("") || `<p class="meta">No rows to review.</p>`;
  if (rows.length > visibleRows.length) {
    importRows.insertAdjacentHTML("beforeend", `<p class="meta">Showing first ${visibleRows.length} of ${rows.length} rows.</p>`);
  }
}

function renderImportRow(row) {
  const analysis = row.analysis || {};
  const record = row.record || analysis.record || {};
  const diff = analysis.diff || {};
  const status = row.status || analysis.status || "needs_review";
  const issues = [
    ...(analysis.issues || []),
    ...(diff.conflicts || []).map((item) => `${labelForImportTarget(item.field)} conflict: existing "${item.existing}", incoming "${item.incoming}"`)
  ];
  const fills = (diff.fills || []).map((item) => `${labelForImportTarget(item.field)} will be filled`);
  const tagAdditions = diff.tag_additions?.length ? [`Tags added: ${diff.tag_additions.slice(0, 8).join(", ")}`] : [];
  const miscAdditions = diff.misc_note_additions?.length ? [`Misc notes added: ${diff.misc_note_additions.slice(0, 3).map((item) => item.note).join("; ")}`] : [];
  const details = [...issues, ...fills, ...tagAdditions, ...miscAdditions];
  return `
    <article class="import-row">
      <div class="import-row-main">
        <div>
          <span class="row-number">Row ${escapeHtml(row.row_number)}</span>
          <strong>${escapeHtml(record.name || "Unnamed talent")}</strong>
          <p class="meta">${escapeHtml((record.tags || []).slice(0, 8).join(", ") || "No extracted labels yet")}</p>
        </div>
        <div class="row-status">
          <span class="status-chip ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
          <span>${percent(row.confidence ?? analysis.confidence)}</span>
        </div>
      </div>
      ${analysis.entity_match ? `<p class="meta">Matched existing roster record: ${escapeHtml(analysis.entity_match.name)} (${escapeHtml(analysis.entity_match.type)}, ${percent(analysis.entity_match.confidence)})</p>` : `<p class="meta">No existing roster match found.</p>`}
      ${details.length ? `<ul>${details.slice(0, 5).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p class="meta">Ready for automatic commit.</p>`}
    </article>
  `;
}

async function commitImportBatch() {
  const batch = state.importBatch;
  if (!batch || batch.status === "committed") return;
  commitImportButton.disabled = true;
  commitImportButton.textContent = "Committing...";
  try {
    const result = await api(`/api/import-batches/${encodeURIComponent(batch.id)}/commit`, {
      method: "POST",
      body: { mapping: collectImportMapping() }
    });
    state.importBatch = result.batch;
    await Promise.all([loadTalents(), loadSuggestions()]);
    renderImportReview();
    const summary = result.summary || {};
    showToast(`Committed ${summary.committed || 0} rows. ${summary.skipped || 0} need review.`);
    if (!summary.skipped) importDialog.close();
  } catch (error) {
    commitImportButton.disabled = false;
    commitImportButton.textContent = "Commit safe rows";
    showToast(error.message);
  }
}

function collectImportMapping() {
  const selects = new Map([...importMapping.querySelectorAll("[data-map-index]")]
    .map((select) => [Number(select.dataset.mapIndex), select.value]));
  return (state.importBatch?.proposed_mapping || []).map((entry) => ({
    ...entry,
    target: entry.target === "sensitive_ignore" ? "sensitive_ignore" : selects.get(Number(entry.index)) || entry.target || "ignore"
  }));
}

function labelForImportTarget(value) {
  return IMPORT_TARGET_OPTIONS.find(([target]) => target === value)?.[1] || String(value || "").replaceAll("_", " ");
}

function statusLabel(status) {
  return String(status || "needs_review").replaceAll("_", " ");
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0%";
  return `${Math.round(number * 100)}%`;
}

function averageConfidence(rows) {
  const values = rows.map((row) => Number(row.confidence)).filter(Number.isFinite);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function exportRoster() {
  window.location.href = "/api/export";
}

async function exportDatabaseBackup() {
  try {
    const response = await fetch("/api/backups", { method: "POST" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Backup failed.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || "talent-backup.sqlite";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Database backup downloaded.");
  } catch (error) {
    showToast(error.message);
  }
}

async function scanDuplicates() {
  try {
    const result = await api("/api/duplicates/scan", { method: "POST" });
    await loadSuggestions();
    showToast(`Duplicate scan complete: ${result.suggestions.length} suggestion${result.suggestions.length === 1 ? "" : "s"}.`);
  } catch (error) {
    showToast(error.message);
  }
}

function renderAnalytics() {
  if (!analyticsPanel || state.activeScreen !== "analytics") return;
  const data = state.analytics;
  if (!data) {
    analyticsPanel.innerHTML = emptyState("Analytics loading.", "Patterns will appear after match history exists.");
    return;
  }
  analyticsPanel.innerHTML = `
    <div class="analytics-grid">
      ${analyticsMetric("Matches", data.totals.matches)}
      ${analyticsMetric("Approved", data.totals.approved)}
      ${analyticsMetric("Discarded", data.totals.discarded)}
      ${analyticsMetric("Open suggestions", data.totals.suggestions_open)}
    </div>
    <section class="analytics-section">
      <h3>Most matched talent</h3>
      ${renderRankedList(data.most_matched_talent, (item) => `${item.name} - ${item.approvals} approved`)}
    </section>
    <section class="analytics-section">
      <h3>Most requested terms</h3>
      ${renderRankedList(data.most_requested_terms, (item) => `${item.term} - ${item.count}`)}
    </section>
    <section class="analytics-section">
      <h3>Weekly outcomes</h3>
      ${renderRankedList(data.weekly_outcomes, (item) => `${item.week}: ${item.approved || 0} approved, ${item.discarded || 0} discarded, ${item.total || 0} total`)}
    </section>
    <section class="analytics-section">
      <h3>Recent discard reasons</h3>
      ${renderRankedList(data.recent_discard_reasons, (item) => `#${item.match_id}: ${item.reason}`)}
    </section>
  `;
}

function analyticsMetric(label, value) {
  return `<article class="analytics-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 0)}</strong></article>`;
}

function renderRankedList(items = [], formatter) {
  if (!items.length) return `<p class="meta">No data yet.</p>`;
  return `<ol>${items.map((item) => `<li>${escapeHtml(formatter(item))}</li>`).join("")}</ol>`;
}

async function runMatch(event) {
  event.preventDefault();
  const brief = briefInput.value.trim();
  if (!brief) {
    showToast("Paste the client request first.");
    return;
  }
  matchResults.classList.remove("empty");
  matchResults.innerHTML = `<div class="understood"><h3>Parsing campaign brief...</h3><p>Generating search terms, checking hard filters, and preparing a roster-prioritized First Draft.</p></div>`;
  try {
    const data = await api("/api/match", {
      method: "POST",
      body: { brief, enrichWeb: webEnrichment.checked }
    });
    state.currentMatch = data;
    await loadHistory();
    renderMatch(data, matchResults);
    showToast("Shortlist ready.");
  } catch (error) {
    matchResults.classList.add("empty");
    matchResults.innerHTML = `<h3>Match failed.</h3><p>${escapeHtml(error.message)}</p>`;
  }
}

function renderMatch(payload, container) {
  const result = payload.result;
  const requirements = payload.requirements || result.requirements || {};
  container.innerHTML = `
    ${renderWorkflowRail()}
    <section class="understood">
      <h3>Step 1 · Brief intake</h3>
      ${renderRequirements(requirements)}
      ${renderCriteria(result.criteria)}
      ${renderWorkflowSummary(result.workflow)}
    </section>
    <section class="shortlist-section">
      <div class="section-rulehead">
        <h3>First Draft</h3>
        <p class="meta">Roster-first survivors after hard-filter checks, ordered by soft-rank evidence. Use this as an internal draft before Deep Research.</p>
      </div>
      ${(result.shortlist || []).map((item) => renderShortlistCard(item, payload.history_id)).join("") || emptyState("No shortlist yet.", "Add more roster evidence or make the client request more specific.")}
    </section>
    <section class="close-list">
      <h3>Excluded / backups</h3>
      <p class="meta">Close candidates, blocked candidates, or backups to revisit if someone fails Deep Research, COI, budget, or availability verification.</p>
      ${renderCloseList(result.excluded_but_close)}
    </section>
    <section class="review-bar">
      <div>
        <strong>Deep Research required before client use.</strong>
        <p>${escapeHtml(result.review_required_notice || "Requires review before external use.")} Verify sources, conflict-of-interest, fee fit, exclusivity, and consent/comfort for sensitive personal-story pitches.</p>
      </div>
      <div class="review-actions">
        <button class="secondary" data-copy-client="${payload.history_id}" type="button">Copy client-ready draft</button>
        <button data-action="approve" data-history-id="${payload.history_id}" type="button">Approve First Draft</button>
        <button class="secondary" data-action="discard" data-history-id="${payload.history_id}" type="button">Discard</button>
      </div>
    </section>
  `;
  container.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => markMatch(button.dataset.historyId, button.dataset.action));
  });
  container.querySelectorAll("[data-copy-client]").forEach((button) => {
    button.addEventListener("click", () => copyClientView(button.dataset.copyClient));
  });
}

function renderWorkflowRail() {
  const steps = [
    ["01", "Brief", "Parse fields + terms"],
    ["02", "Sources", "Roster + ArchiveDB"],
    ["03", "Filters", "Eligibility + COI"],
    ["04", "Soft Rank", "Theme + audience"],
    ["05", "First Draft", "Internal shortlist"],
    ["06", "Deep Research", "Verify before client"]
  ];
  return `
    <section class="workflow-rail" aria-label="Casting workflow">
      ${steps.map((step, index) => `
        <div class="workflow-step ${index === 4 ? "active" : ""}">
          <span>${step[0]}</span>
          <strong>${step[1]}</strong>
          <small>${step[2]}</small>
        </div>
      `).join("")}
    </section>
  `;
}

function renderRequirements(requirements = {}) {
  const chips = [
    ...requirementChips("Skills", requirements.skills),
    ...requirementChips("Tone", requirements.tone),
    ...requirementChips("Category", requirements.category)
  ];
  const location = requirements.location || {};
  const budget = requirements.budget_range || {};
  const availability = requirements.availability_window || {};
  if (location.raw || location.city || location.remote_ok) {
    chips.push(`Location: ${[location.city, location.region].filter(Boolean).join(", ") || location.raw || (location.remote_ok ? "remote" : "")}`);
  }
  if (budget.raw || budget.min || budget.max) {
    chips.push(`Budget: ${formatBudget(budget)}`);
  }
  if (availability.raw || availability.start || availability.end) {
    chips.push(`Timing: ${availability.raw || [availability.start, availability.end].filter(Boolean).join(" to ")}`);
  }
  return `<div class="requirements">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("") || `<span>Structured requirements not detected yet</span>`}</div>`;
}

function renderWorkflowSummary(workflow = {}) {
  const filters = workflow.hard_filters || workflow.hardFilters || [];
  const rankBasis = workflow.soft_rank_basis || workflow.softRankBasis || [];
  const verification = workflow.verification_required || workflow.verificationRequired || [];
  if (!filters.length && !rankBasis.length && !verification.length) return "";
  return `
    <div class="workflow-summary">
      <div>
        <strong>Hard filters</strong>
        <ul>${filters.map((item) => `<li><span>${escapeHtml(item.status || "review")}</span> ${escapeHtml(item.filter || "")}${item.note ? ` — ${escapeHtml(item.note)}` : ""}</li>`).join("") || "<li><span>review</span> No hard filters returned.</li>"}</ul>
      </div>
      <div>
        <strong>Soft rank basis</strong>
        <ul>${rankBasis.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>Roster-first sourced evidence.</li>"}</ul>
      </div>
      <div>
        <strong>Deep Research checklist</strong>
        <ul>${verification.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>Verify sources and COI before client use.</li>"}</ul>
      </div>
    </div>
  `;
}

function requirementChips(label, items = []) {
  return (items || []).map((item) => `${label}: ${item.value || item}`);
}

function formatBudget(budget = {}) {
  const currency = budget.currency || "USD";
  const money = (value) => value == null || value === "" ? "" : `${currency} ${Number(value).toLocaleString()}`;
  if (budget.min && budget.max && budget.min !== budget.max) return `${money(budget.min)}-${money(budget.max)}`;
  if (budget.min && budget.max && budget.min === budget.max) return money(budget.max);
  if (budget.max) return `up to ${money(budget.max)}`;
  if (budget.min) return money(budget.min);
  return budget.raw || "not stated";
}

function renderCriteria(criteria = {}) {
  const lines = [];
  for (const item of criteria.stated || []) lines.push(`<li><strong>Search term:</strong> ${escapeHtml(item.criterion)}</li>`);
  for (const item of criteria.inferred || []) lines.push(`<li><strong>Soft-rank assumption:</strong> ${escapeHtml(item.criterion)} <span>${escapeHtml(item.justification || "")}</span></li>`);
  for (const item of criteria.ambiguous || []) lines.push(`<li><strong>Hard-filter review:</strong> ${escapeHtml(item.criterion)} <span>${escapeHtml(item.reason || "")}</span></li>`);
  return `<ul>${lines.join("") || "<li>No criteria returned.</li>"}</ul>`;
}

function renderShortlistCard(item, historyId) {
  const talent = state.talents.find((candidate) => Number(candidate.id) === Number(item.talent_id)) || { name: item.name };
  return `
    <article class="result-card">
      ${renderPhoto(talent)}
      <div>
        <div class="talent-title">
          <h3>${escapeHtml(item.name)}</h3>
          <span class="fit ${String(item.fit || "low").toLowerCase()}">${escapeHtml(item.fit || "Low")} soft rank</span>
        </div>
        <p>${escapeHtml(item.rationale || "Selected based on sourced roster evidence.")}</p>
        ${renderScoreDrivers(item.score_drivers || [])}
        ${renderLiveSearchFindings(item.live_search_findings || [])}
        <div class="claim-list">${(item.claims || []).map(renderClaim).join("")}</div>
        ${(item.cautions || []).map((caution) => `<p class="meta">Flag: ${escapeHtml(caution)}</p>`).join("")}
      </div>
    </article>
  `;
}

function renderLiveSearchFindings(findings = []) {
  if (!findings.length) return "";
  return `
    <details class="live-search-panel" open>
      <summary>Deep Research source check</summary>
      <div>
        ${findings.map((finding) => `
          <article class="live-search-finding ${escapeHtml(finding.confidence || "inconclusive")}">
            <div class="live-search-head">
              <span>Tier 3 · ${escapeHtml(finding.confidence || "inconclusive")}</span>
              <small>${escapeHtml(shortTime(finding.fetched_at))}</small>
            </div>
            <p>${escapeHtml(finding.rationale || "Unable to classify live-search evidence.")}</p>
            ${(finding.findings || []).slice(0, 3).map((source) => `
              <a href="${escapeHtml(source.source_url || "#")}" target="_blank" rel="noreferrer">
                ${escapeHtml(source.source_title || source.source_url || "Public source")}
              </a>
            `).join("")}
          </article>
        `).join("")}
      </div>
    </details>
  `;
}

function renderScoreDrivers(drivers = []) {
  if (!drivers.length) return "";
  return `
    <details class="score-drivers">
      <summary>Soft-rank signals</summary>
      <div>
        ${drivers.slice(0, 8).map((driver) => `
          <span title="${escapeHtml(driver.source?.field || driver.field || "source")}">
            ${escapeHtml(driver.weight ? `+${driver.weight} ` : "")}${escapeHtml(driver.field ? fieldDisplay(driver.field) : "Signal")}: ${escapeHtml(driver.term || driver.label || "")}
          </span>
        `).join("")}
      </div>
    </details>
  `;
}

function fieldDisplay(field) {
  return String(field || "").replaceAll("_", " ");
}

function renderClaim(claim) {
  const source = claim.source || {};
  const sourceText = source.type === "live_search"
    ? `<a href="${escapeHtml(source.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(source.title || "live search source")}</a> <span>Tier 3 · ${escapeHtml(source.confidence || "inconclusive")}</span>`
    : source.type === "external"
    ? `<a href="${escapeHtml(source.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(source.title || source.url || "public source")}</a>`
    : `${escapeHtml(source.field || "roster note")} updated ${escapeHtml(shortTime(source.updated_at))}`;
  return `<div class="claim">${escapeHtml(claim.claim || "")}<br><span>Source: ${sourceText}</span></div>`;
}

function renderCloseList(items = []) {
  if (!items.length) return `<p class="meta">No backups or exclusions returned.</p>`;
  return `<ul>${items.map((item) => `<li><strong>${escapeHtml(item.name)}</strong>: ${escapeHtml(item.reason || "")}</li>`).join("")}</ul>`;
}

async function copyClientView(historyId) {
  try {
    const data = await api(`/api/history/${encodeURIComponent(historyId)}/client-export`);
    await navigator.clipboard.writeText(data.text);
    showToast("Client view copied.");
  } catch (error) {
    showToast(error.message);
  }
}

async function markMatch(historyId, action) {
  const outcome = action === "approve" ? "approved" : "discarded";
  let feedback = action === "approve" ? "Boss approved this shortlist for copy-out." : "";
  if (action === "discard") {
    const reason = window.prompt("Why discard this shortlist? Optional, but useful for future matches.");
    if (reason === null) return;
    feedback = reason.trim();
  }
  await api(`/api/history/${historyId}/feedback`, {
    method: "PATCH",
    body: { outcome, feedback }
  });
  if (action === "approve") {
    await offerAvailabilityHolds(historyId);
  }
  await Promise.all([loadHistory(), loadSuggestions()]);
  showToast(action === "approve" ? "Approved. Suggested profile notes were added to the inbox." : feedback ? "Discarded. Feedback suggestions were added to the inbox." : "Discarded.");
}

async function offerAvailabilityHolds(historyId) {
  const entry = state.history.find((item) => Number(item.id) === Number(historyId))
    || (state.currentMatch && Number(state.currentMatch.history_id) === Number(historyId) ? state.currentMatch : null);
  const result = entry?.result || {};
  const dateWindow = entry?.requirements?.availability_window || result.requirements?.availability_window || {};
  const start = dateWindow.start || parseIsoDate(dateWindow.raw);
  const end = dateWindow.end || start;
  if (!start || !end || !(result.shortlist || []).length) return;
  if (!globalThis.confirm(`Mark approved shortlist as held for ${start}${end !== start ? ` to ${end}` : ""}?`)) return;
  for (const item of result.shortlist || []) {
    if (!item.talent_id) continue;
    await api(`/api/talents/${encodeURIComponent(item.talent_id)}/availability`, {
      method: "POST",
      body: {
        status: "held",
        start_date: start,
        end_date: end,
        note: `Approved match #${historyId}`
      }
    }).catch(() => null);
  }
}

function parseIsoDate(value) {
  return /(\d{4}-\d{2}-\d{2})/.exec(String(value || ""))?.[1] || "";
}

function renderHistory() {
  historyList.innerHTML = state.history.map((entry) => `
    <button class="history-item ${entry.id === state.selectedHistoryId ? "active" : ""}" data-id="${entry.id}" type="button">
      <strong>${escapeHtml(shortTime(entry.created_at))}</strong>
      <span>${escapeHtml(entry.brief)}</span>
      <span class="meta">${escapeHtml((entry.result.shortlist || []).map((item) => item.name).join(", ") || "No shortlist")} · ${escapeHtml(entry.outcome || "draft")}</span>
    </button>
  `).join("") || emptyState("No match history yet.", "Run your first client request on the New Match screen.");

  $$(".history-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedHistoryId = Number(button.dataset.id);
      const entry = state.history.find((item) => item.id === state.selectedHistoryId);
      if (!entry) return;
      historyDetail.innerHTML = `<p class="meta">${escapeHtml(entry.brief)}</p>`;
      renderMatch({ history_id: entry.id, requirements: entry.requirements, result: entry.result, model_source: entry.model_source, model_name: entry.model_name }, historyDetail);
      renderHistory();
    });
  });
}

function renderSuggestions() {
  if (!suggestionsList) return;
  suggestionsList.innerHTML = state.suggestions.map(renderSuggestionItem).join("")
    || emptyState("Inbox is clear.", "New import issues, tag ideas, match notes, and stale-field nudges will appear here.");
  suggestionsList.querySelectorAll("[data-suggestion-action]").forEach((button) => {
    button.addEventListener("click", () => resolveSuggestionItem(button.dataset.suggestionId, button.dataset.suggestionAction));
  });
}

function renderSuggestionItem(item) {
  const primary = suggestionPrimaryAction(item);
  const secondary = suggestionSecondaryAction(item);
  return `
    <article class="suggestion-item ${escapeHtml(item.type)}">
      <div>
        <p class="kicker">${escapeHtml(suggestionTypeLabel(item.type))}</p>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.body || suggestionBodyFromPayload(item))}</p>
        <div class="suggestion-meta">
          ${item.talent_name ? `<span>${escapeHtml(item.talent_name)}</span>` : ""}
          ${item.match_id ? `<span>match #${escapeHtml(item.match_id)}</span>` : ""}
          ${item.import_batch_id ? `<span>import #${escapeHtml(item.import_batch_id)}</span>` : ""}
          <span>${escapeHtml(item.source || "system")}</span>
          <span>${escapeHtml(percent(item.confidence || 0))}</span>
        </div>
        ${renderSuggestionPayloadChips(item)}
      </div>
      <div class="suggestion-actions">
        ${primary ? `<button type="button" data-suggestion-id="${item.id}" data-suggestion-action="${escapeHtml(primary.action)}">${escapeHtml(primary.label)}</button>` : ""}
        ${secondary ? `<button class="secondary" type="button" data-suggestion-id="${item.id}" data-suggestion-action="${escapeHtml(secondary.action)}">${escapeHtml(secondary.label)}</button>` : ""}
        <button class="secondary" type="button" data-suggestion-id="${item.id}" data-suggestion-action="dismiss">Dismiss</button>
      </div>
    </article>
  `;
}

function suggestionPrimaryAction(item) {
  const action = item.payload?.default_action;
  if (action === "apply_tags") return { action, label: "Add tags" };
  if (action === "apply_note") return { action, label: "Save note" };
  if (action === "confirm_current") return { action, label: "Still accurate" };
  if (action === "mark_wikidata_reviewed") return { action, label: "Mark reviewed" };
  if (action === "refresh_wikidata") return { action, label: "Refresh" };
  if (action === "apply_wikidata_refresh") return { action, label: "Apply refresh" };
  if (item.type === "possible_duplicate") return { action: "merge_duplicate", label: "Merge records" };
  return null;
}

function suggestionSecondaryAction(item) {
  const action = item.payload?.secondary_action;
  if (action === "refresh_wikidata") return { action, label: "Refresh" };
  if (action === "mark_wikidata_reviewed") return { action, label: "Mark reviewed" };
  return null;
}

function suggestionTypeLabel(type) {
  return String(type || "suggestion").replaceAll("_", " ");
}

function suggestionBodyFromPayload(item) {
  if (item.payload?.tags?.length) return `Suggested tags: ${item.payload.tags.join(", ")}`;
  if (item.payload?.field) return `Review ${item.payload.field}.`;
  return "";
}

function renderSuggestionPayloadChips(item) {
  const chips = [];
  if (item.payload?.tags?.length) chips.push(...item.payload.tags.map((tag) => `tag: ${tag}`));
  if (item.payload?.field) chips.push(`field: ${item.payload.field}`);
  if (item.payload?.status) chips.push(`status: ${item.payload.status}`);
  if (item.payload?.talent_a && item.payload?.talent_b) chips.push(`${item.payload.talent_a} <-> ${item.payload.talent_b}`);
  if (item.payload?.matched_fields?.length) chips.push(...item.payload.matched_fields.slice(0, 3));
  if (item.payload?.diff?.length) chips.push(...item.payload.diff.slice(0, 4).map((diff) => `${diff.field}: ${diff.current || "(blank)"} -> ${diff.proposed || "(blank)"}`));
  return chips.length ? `<div class="suggestion-chips">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("")}</div>` : "";
}

async function resolveSuggestionItem(id, action) {
  const body = { action };
  const item = state.suggestions.find((suggestion) => Number(suggestion.id) === Number(id));
  if (action === "merge_duplicate") {
    const choice = chooseDuplicatePrimary(item);
    if (!choice) return;
    body.primary_id = choice.primary_id;
    body.secondary_id = choice.secondary_id;
  }
  await api(`/api/suggestions/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body
  });
  await Promise.all([loadTalents(), loadSuggestions()]);
  showToast(action === "dismiss" ? "Suggestion dismissed." : action === "merge_duplicate" ? "Duplicate records merged." : "Suggestion applied.");
}

function chooseDuplicatePrimary(item) {
  const payload = item?.payload || {};
  const leftId = Number(payload.talent_id_a);
  const rightId = Number(payload.talent_id_b);
  if (!leftId || !rightId) {
    showToast("Duplicate suggestion is missing record ids.");
    return null;
  }
  const leftLabel = payload.talent_a || `Talent #${leftId}`;
  const rightLabel = payload.talent_b || `Talent #${rightId}`;
  const keepRight = window.confirm(`Merge these records?\n\nOK keeps "${rightLabel}" as primary.\nCancel keeps "${leftLabel}" as primary.`);
  const primaryId = keepRight ? rightId : leftId;
  const secondaryId = keepRight ? leftId : rightId;
  if (!window.confirm(`Confirm merge:\n\nKeep: ${primaryId === leftId ? leftLabel : rightLabel}\nArchive: ${secondaryId === leftId ? leftLabel : rightLabel}`)) return null;
  return { primary_id: primaryId, secondary_id: secondaryId };
}

async function api(path, options = {}) {
  const init = { method: options.method || "GET", headers: { ...(options.headers || {}) } };
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      init.body = options.body;
    } else {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
  }
  const response = await fetch(path, init);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok && !(response.status === 401 && options.allowUnauthorized)) {
    const error = new Error(data.error || data || `Request failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function fileToBase64(file) {
  const dataUrl = await fileToDataUrl(file);
  return String(dataUrl).split(",")[1] || "";
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function shortTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function shortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", day: "2-digit", year: "numeric" });
}

function emptyState(title, body) {
  return `<div class="understood"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2800);
}
