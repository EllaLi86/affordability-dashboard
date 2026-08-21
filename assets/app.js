const STORAGE_KEY = "housing-access-demo-state-v3";
const DEMO_START_DATE = new Date("2026-08-20T12:00:00");

const state = {
  applications: [],
  properties: [],
  selectedId: null,
  statusGroup: "all",
  stage: "all",
  priority: "all",
  size: "all",
  bedrooms: "all",
  documents: "all",
  match: "all",
  search: "",
  sort: "priority",
  mapLoaded: false,
  toastTimer: null,
};

const statusLabels = {
  "new": "New",
  "needs-information": "Needs information",
  "ready-to-match": "Ready to match",
  "matches-found": "Matches found",
  "application-in-progress": "Application in progress",
  "submitted-to-property": "Submitted to property",
  "waitlisted": "Waitlisted",
  "housed": "Housed",
};

const statusGroups = {
  "needs-action": ["new", "needs-information"],
  "ready": ["ready-to-match"],
  "matches": ["matches-found"],
  "progress": ["application-in-progress", "submitted-to-property", "waitlisted"],
  "housed": ["housed"],
};

const housingLabels = {
  "unhoused": "Currently unhoused",
  "eviction": "Eviction or move-out notice",
  "temporary": "Temporary or doubled-up housing",
  "severe-burden": "Severe housing-cost burden",
  "stable": "Stable current housing",
  "not-recorded": "Not yet recorded",
};

const documentLabels = {
  identity: "Identity documentation",
  income: "Income verification",
  residency: "County residency",
  household: "Household composition",
  housing: "Current housing evidence",
  consent: "Program consent",
  assets: "Asset declaration",
  application: "Signed application",
  release: "Property information release",
};

const propertyMatchLabels = {
  likely: "Likely eligible",
  potential: "Potential match",
  verification: "Verification required",
  "not-suitable": "Not suitable",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function currentReviewDate() {
  const now = new Date();
  return now > DEMO_START_DATE ? now : DEMO_START_DATE;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(`${dateString}T12:00:00`));
}

function initials(name) {
  return name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function householdSize(application) {
  return Number(application.adults) + Number(application.children);
}

function bedroomNeed(application) {
  if (application.bedroomNeed) return Number(application.bedroomNeed);
  const size = householdSize(application);
  if (size <= 2) return 1;
  if (size <= 4) return 2;
  if (size <= 6) return 3;
  return 4;
}

function bedroomNeedLabel(application) {
  const size = householdSize(application);
  if (size >= 5 && size <= 6) return "3–4 BR";
  return `${bedroomNeed(application)} BR`;
}

function affordabilityGap(application) {
  return Number(application.income) - Number(application.hlb);
}

function formatGapCompact(value) {
  const sign = value < 0 ? "−" : "+";
  const amount = Math.round(Math.abs(value) / 1000);
  return `${sign}$${amount}K/year`;
}

function getDocumentSummary(application) {
  const entries = Object.entries(application.documents || {});
  const completed = entries.filter(([, complete]) => complete).length;
  const missing = entries.filter(([, complete]) => !complete).map(([key]) => documentLabels[key] || key);
  return { completed, total: entries.length, missing, complete: missing.length === 0 };
}

function getPriority(application) {
  const coverage = application.hlb > 0 ? application.income / application.hlb : 1;
  const financial = Math.round(clamp((1 - coverage) * 53.34, 0, 40));
  const housingPoints = { "unhoused": 25, "eviction": 21, "temporary": 14, "severe-burden": 10, "stable": 0 };
  const housing = housingPoints[application.housing] || 0;
  const size = householdSize(application);
  let household = 0;
  if (application.children > 0) household += 6;
  if (application.children > 0 && application.youngestChild <= 5) household += 4;
  if (application.adults === 1 && application.children > 0) household += 4;
  if (size >= 5) household += 6;
  household = Math.min(household, 20);
  const submitted = new Date(`${application.submitted}T12:00:00`);
  const daysWaiting = Math.max(0, Math.floor((currentReviewDate() - submitted) / 86400000));
  const wait = Math.min(15, Math.floor(daysWaiting / 7));
  const internalScore = financial + housing + household + wait;
  const level = internalScore >= 65 ? "high" : "standard";

  return {
    level,
    internalScore,
    factors: "Based on financial gap, housing instability, household needs, and time waiting.",
  };
}

function matchProperty(application, property) {
  const size = householdSize(application);
  const need = bedroomNeed(application);
  const incomeFits = application.income <= property.incomeLimit;
  const occupancyFits = size >= property.minHousehold && size <= property.maxHousehold;
  const bedroomFits = property.bedrooms >= need;
  const preferredLocation = property.pumas.includes(application.puma);
  const incomeVerified = Boolean(application.documents?.income);

  let result;
  let reason;
  if (!occupancyFits) {
    result = "not-suitable";
    reason = size > property.maxHousehold
      ? "Not suitable — household exceeds the published occupancy limit."
      : "Not suitable — household is below the unit's minimum occupancy requirement.";
  } else if (!bedroomFits) {
    result = "not-suitable";
    reason = "Not suitable — this unit does not meet the household's bedroom requirement.";
  } else if (!incomeFits) {
    result = "not-suitable";
    reason = "Not suitable — reported income exceeds the property's published income limit.";
  } else if (!incomeVerified) {
    result = "verification";
    reason = "Additional verification required — income documentation is missing.";
  } else if (preferredLocation) {
    result = "likely";
    reason = "Likely eligible based on income, household size, bedroom need, and preferred area.";
  } else {
    result = "potential";
    reason = "Potential match based on income and occupancy; confirm location preference with the applicant.";
  }

  return { property, result, reason, preferredLocation };
}

function getPropertyMatches(application) {
  const order = { likely: 0, verification: 1, potential: 2, "not-suitable": 3 };
  const evaluated = state.properties
    .map((property) => matchProperty(application, property))
    .sort((a, b) => order[a.result] - order[b.result] || Number(b.preferredLocation) - Number(a.preferredLocation));
  const strongest = evaluated.filter((match) => match.result !== "not-suitable").slice(0, 3);
  const contrast = evaluated.find((match) => match.result === "not-suitable");
  const examples = contrast ? [...strongest, contrast] : strongest;
  return examples.length < 4
    ? [...examples, ...evaluated.filter((match) => !examples.includes(match)).slice(0, 4 - examples.length)]
    : examples.slice(0, 4);
}

function getMatchSummary(application) {
  const matches = getPropertyMatches(application);
  const viable = matches.filter((match) => match.result !== "not-suitable");
  const likely = matches.filter((match) => match.result === "likely" || match.result === "potential");
  const verification = matches.filter((match) => match.result === "verification");
  return { matches, viable, likely, verification };
}

function loadStoredState(applications) {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const changes = stored.changes || {};
    const merged = applications.map((application) => ({ ...application, ...(changes[application.id] || {}) }));
    return merged.concat(Array.isArray(stored.added) ? stored.added : []);
  } catch (_error) {
    return applications;
  }
}

function saveStoredState() {
  const seedIds = new Set(["HA-260184", "HA-260191", "HA-260196", "HA-260203", "HA-260207", "HA-260211", "HA-260215", "HA-260218", "HA-260220", "HA-260223", "HA-260227", "HA-260229"]);
  const changes = {};
  const added = [];

  state.applications.forEach((application) => {
    if (seedIds.has(application.id)) {
      changes[application.id] = {
        status: application.status,
        reviewer: application.reviewer,
        note: application.note,
        documents: application.documents,
      };
    } else {
      added.push(application);
    }
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ changes, added }));
}

function statusGroupMatches(application) {
  if (state.statusGroup === "all") return true;
  return statusGroups[state.statusGroup]?.includes(application.status) || false;
}

function getFilteredApplications() {
  const query = state.search.trim().toLowerCase();
  const filtered = state.applications.filter((application) => {
    const size = householdSize(application);
    const docs = getDocumentSummary(application);
    const priority = getPriority(application);
    const matches = getMatchSummary(application);
    const stageMatch = state.stage === "all" || application.status === state.stage;
    const priorityMatch = state.priority === "all" || priority.level === state.priority;
    const sizeMatch = state.size === "all"
      || (state.size === "1-3" && size <= 3)
      || (state.size === "4-5" && size >= 4 && size <= 5)
      || (state.size === "6+" && size >= 6);
    const bedroomMatch = state.bedrooms === "all" || bedroomNeed(application) === Number(state.bedrooms);
    const documentMatch = state.documents === "all"
      || (state.documents === "missing" && !docs.complete)
      || (state.documents === "complete" && docs.complete);
    const matchMatch = state.match === "all"
      || (state.match === "likely" && matches.likely.length > 0)
      || (state.match === "verification" && matches.verification.length > 0)
      || (state.match === "none" && matches.viable.length === 0);
    const searchMatch = !query || application.applicant.toLowerCase().includes(query) || application.id.toLowerCase().includes(query);
    return statusGroupMatches(application) && stageMatch && priorityMatch && sizeMatch && bedroomMatch && documentMatch && matchMatch && searchMatch;
  });

  return filtered.sort((a, b) => {
    if (state.sort === "oldest") return a.submitted.localeCompare(b.submitted);
    if (state.sort === "newest") return b.submitted.localeCompare(a.submitted);
    if (state.sort === "name") return a.applicant.localeCompare(b.applicant);
    const priorityRank = { high: 0, standard: 1 };
    return priorityRank[getPriority(a).level] - priorityRank[getPriority(b).level] || a.submitted.localeCompare(b.submitted);
  });
}

function renderMetrics() {
  const active = state.applications.filter((application) => application.status !== "housed");
  const highPriority = active.filter((application) => getPriority(application).level === "high").length;
  const readyToMatch = active.filter((application) => application.status === "ready-to-match").length;
  const missingDocuments = active.filter((application) => !getDocumentSummary(application).complete).length;

  document.getElementById("application-metrics").innerHTML = `
    <article class="metric-card"><span>Active Applicants</span><strong>${active.length}</strong><small>${state.applications.length} total cases</small></article>
    <article class="metric-card emphasis"><span>High Priority Households</span><strong>${highPriority}</strong><small>review order only</small></article>
    <article class="metric-card"><span>Ready to Match</span><strong>${readyToMatch}</strong><small>applicant information reviewed</small></article>
    <article class="metric-card"><span>Missing Documents</span><strong>${missingDocuments}</strong><small>applicants needing follow-up</small></article>
  `;

  const groupCounts = {
    all: state.applications.length,
    "needs-action": state.applications.filter((application) => statusGroups["needs-action"].includes(application.status)).length,
    ready: state.applications.filter((application) => statusGroups.ready.includes(application.status)).length,
    matches: state.applications.filter((application) => statusGroups.matches.includes(application.status)).length,
    progress: state.applications.filter((application) => statusGroups.progress.includes(application.status)).length,
    housed: state.applications.filter((application) => application.status === "housed").length,
  };
  Object.entries(groupCounts).forEach(([group, count]) => {
    const element = document.getElementById(`count-${group}`);
    if (element) element.textContent = count;
  });
  document.getElementById("nav-new-count").textContent = groupCounts["needs-action"];
}

function renderTable() {
  const applications = getFilteredApplications();
  const rows = document.getElementById("application-rows");
  const empty = document.getElementById("empty-state");
  document.getElementById("queue-summary").textContent = `${applications.length} of ${state.applications.length} applicants shown`;
  empty.hidden = applications.length !== 0;

  if (applications.length && !applications.some((application) => application.id === state.selectedId)) {
    state.selectedId = applications[0].id;
  }

  rows.innerHTML = applications.map((application) => {
    const size = householdSize(application);
    const docs = getDocumentSummary(application);
    const matches = getMatchSummary(application);
    const priority = getPriority(application);
    const isSelected = application.id === state.selectedId;
    return `
      <tr data-application-id="${escapeHtml(application.id)}" class="${isSelected ? "selected" : ""}" tabindex="0" aria-selected="${isSelected}">
        <td><div class="applicant-cell"><span class="applicant-avatar">${escapeHtml(initials(application.applicant))}</span><div><strong>${escapeHtml(application.applicant)}</strong><span>${escapeHtml(application.id)} · ${statusLabels[application.status]}</span></div></div></td>
        <td><div class="cell-stack"><strong>${size} people</strong><span>${application.children} ${application.children === 1 ? "child" : "children"}</span></div></td>
        <td><div class="cell-stack gap-cell"><strong>${formatGapCompact(affordabilityGap(application))}</strong><span>affordability gap</span></div></td>
        <td><div class="cell-stack"><strong>${bedroomNeedLabel(application)}</strong><span>${escapeHtml(application.area.split("&")[0].trim())}</span></div></td>
        <td><div class="cell-stack match-cell"><strong>${matches.viable.length} housing ${matches.viable.length === 1 ? "match" : "matches"}</strong><span>${matches.likely.length} likely · ${matches.verification.length} verify</span></div></td>
        <td><div class="cell-stack document-cell"><strong>${docs.completed}/${docs.total} documents</strong><span class="${docs.complete ? "complete-text" : "missing-text"}">${docs.complete ? "Complete" : `${docs.missing.length} missing`}</span></div></td>
        <td><div class="priority-cell"><span class="badge priority-${priority.level}">${priority.level === "high" ? "High priority" : "Standard review"}</span><small>Review order only</small></div></td>
      </tr>
    `;
  }).join("");
}

function getNextAction(application, docs, matches) {
  if (application.status === "housed") return { title: "Schedule placement follow-up", detail: "Confirm the household's 30-day follow-up and close remaining support tasks." };
  if (docs.missing.length) return { title: `Request ${docs.missing[0].toLowerCase()}`, detail: `Applicant has ${docs.completed} of ${docs.total} required documents.` };
  if (application.status === "waitlisted") return { title: "Confirm waitlist status", detail: "Check the property update schedule and confirm applicant contact information." };
  if (application.status === "submitted-to-property") return { title: "Check property response", detail: "Confirm receipt and record any additional property requirements." };
  if (application.status === "application-in-progress") return { title: "Complete selected property application", detail: "Review property-specific fields with the applicant before submission." };
  if (matches.viable.length) return { title: "Review potential housing matches", detail: `${matches.viable.length} properties meet the initial income and occupancy checks.` };
  return { title: "Review housing need and property criteria", detail: "No current property passed the initial comparison." };
}

function renderMatchCard(match) {
  const property = match.property;
  return `
    <article class="property-match ${match.result}">
      <div class="property-match-head"><div><h4>${escapeHtml(property.name)}</h4><span>${escapeHtml(property.location)} · ${property.bedrooms} BR</span></div><span class="badge match-${match.result}">${propertyMatchLabels[match.result]}</span></div>
      <p>${escapeHtml(match.reason)}</p>
      <div class="property-requirements"><span>Income limit ${formatMoney(property.incomeLimit)}</span><span>${property.minHousehold}–${property.maxHousehold} occupants</span><span>${escapeHtml(property.availability)}</span></div>
      <button class="text-button" type="button" data-property-id="${escapeHtml(property.id)}">View match requirements →</button>
    </article>
  `;
}

function renderCasePanel() {
  const panel = document.getElementById("case-panel");
  const application = state.applications.find((item) => item.id === state.selectedId);
  if (!application || !getFilteredApplications().some((item) => item.id === application.id)) {
    panel.innerHTML = `<div class="empty-state"><span aria-hidden="true">▤</span><h3>Select an applicant</h3><p>Case details and property matches will appear here.</p></div>`;
    return;
  }

  const size = householdSize(application);
  const docs = getDocumentSummary(application);
  const matches = getMatchSummary(application);
  const priority = getPriority(application);
  const nextAction = getNextAction(application, docs, matches);
  const gap = affordabilityGap(application);
  const transition = getNextStage(application.status);

  panel.innerHTML = `
    <div class="case-panel-inner">
      <div class="case-head">
        <div class="case-head-top"><div><h2>${escapeHtml(application.applicant)}</h2><p>${escapeHtml(application.id)} · Updated ${formatDate(application.submitted)}</p></div><span class="badge priority-${priority.level}">${priority.level === "high" ? "High priority" : "Standard review"}</span></div>
        <div class="case-badges"><span class="badge ${application.status}">${statusLabels[application.status]}</span><span class="human-review-label">Human-reviewed case</span></div>
      </div>

      <div class="case-scroll">
        <section class="next-action-card">
          <p class="eyebrow">NEXT RECOMMENDED ACTION</p>
          <h3>${escapeHtml(nextAction.title)}</h3>
          <p>${escapeHtml(nextAction.detail)}</p>
          <div class="next-action-buttons">
            <button class="secondary-button" type="button" data-panel-action="request-documents">Request Documents</button>
            <button class="secondary-button" type="button" data-panel-action="view-matches">View Housing Matches</button>
            <button class="secondary-button" type="button" data-panel-action="contact">Contact Applicant</button>
          </div>
        </section>

        <section class="case-section">
          <h3>Who they are</h3>
          <div class="fact-grid">
            <div class="fact"><span>Household size</span><strong>${size} people</strong></div>
            <div class="fact"><span>Adults</span><strong>${application.adults}</strong></div>
            <div class="fact"><span>Children</span><strong>${application.children}</strong></div>
            <div class="fact"><span>Preferred language</span><strong>${escapeHtml(application.language)}</strong></div>
            <div class="fact"><span>Preferred contact</span><strong>${escapeHtml(application.contact)}</strong></div>
          </div>
        </section>

        <section class="case-section financial-section">
          <h3>Financial situation</h3>
          <div class="financial-facts">
            <div><span>Annual household income</span><strong>${formatMoney(application.income)}</strong></div>
            <div><span>Estimated basic-needs threshold</span><strong>${formatMoney(application.hlb)}</strong></div>
            <div class="gap-fact"><span>Annual affordability gap</span><strong>${formatMoney(gap)} / year</strong></div>
          </div>
          <p class="section-note">The synthetic Household Living Budget is context for need. It is not a final property eligibility determination.</p>
        </section>

        <section class="case-section">
          <h3>Housing need</h3>
          <div class="fact-grid">
            <div class="fact"><span>Bedroom requirement</span><strong>${bedroomNeedLabel(application)}</strong></div>
            <div class="fact"><span>Preferred area</span><strong>${escapeHtml(application.area)}</strong></div>
            <div class="fact"><span>Current situation</span><strong>${housingLabels[application.housing] || "Not recorded"}</strong></div>
          </div>
        </section>

        <section class="case-section progress-section">
          <h3>Application progress</h3>
          <div class="fact-grid">
            <div class="fact"><span>Documents completed</span><strong>${docs.completed} of ${docs.total}</strong></div>
            <div class="fact"><span>Missing documents</span><strong>${docs.missing.length}</strong></div>
            <div class="fact"><span>Housing matches found</span><strong>${matches.viable.length}</strong></div>
            <div class="fact"><span>Current stage</span><strong>${statusLabels[application.status]}</strong></div>
          </div>
        </section>

        <section class="case-section matches-section" data-matches-section>
          <div class="section-heading-row"><div><h3>Potential Housing Matches</h3><p>Initial comparison only · property verification required</p></div><span>${matches.viable.length} potential</span></div>
          <div class="property-match-list">${matches.matches.map(renderMatchCard).join("")}</div>
        </section>

        <section class="case-section priority-explanation">
          <h3>Review priority</h3>
          <div class="priority-summary"><span class="badge priority-${priority.level}">${priority.level === "high" ? "High priority" : "Standard review"}</span><p>${priority.factors}</p></div>
          <p class="section-note">Priority helps staff order their work. It does not determine property eligibility, placement, or who deserves housing.</p>
        </section>

        <section class="case-section">
          <h3>Documents</h3>
          <div class="document-list">
            ${Object.entries(application.documents).map(([key, complete]) => `
              <button class="document-item document-toggle" type="button" data-document-key="${key}" aria-pressed="${complete}">
                <span class="document-status ${complete ? "complete" : "missing"}">${complete ? "✓" : "!"}</span>
                <span>${documentLabels[key]}</span>
                <span class="badge ${complete ? "housed" : "needs-information"}">${complete ? "Verified" : "Missing"}</span>
              </button>
            `).join("")}
          </div>
        </section>

        <section class="case-section">
          <h3>Reviewer note</h3>
          <textarea class="note-box" id="reviewer-note" placeholder="Record the source information checked and the reason for the next action…">${escapeHtml(application.note || "")}</textarea>
          <div class="note-actions"><button class="text-button" type="button" data-save-note>Save note</button></div>
        </section>

        <section class="case-section">
          <h3>Audit details</h3>
          <div class="fact-grid"><div class="fact"><span>Assigned reviewer</span><strong>${escapeHtml(application.reviewer)}</strong></div><div class="fact"><span>Intake channel</span><strong>${escapeHtml(application.channel)}</strong></div><div class="fact"><span>Submitted</span><strong>${formatDate(application.submitted)}</strong></div><div class="fact"><span>Case ID</span><strong>${escapeHtml(application.id)}</strong></div></div>
        </section>
      </div>

      <div class="case-actions">
        <button class="secondary-button" type="button" data-case-action="needs-information">Request information</button>
        <button class="primary-button" type="button" data-case-action="${transition.status}" ${transition.requiresDocuments && !docs.complete ? 'disabled title="Complete required documents before advancing this case"' : ""}>${transition.label}</button>
      </div>
    </div>
  `;
}

function getNextStage(status) {
  const transitions = {
    "new": { status: "ready-to-match", label: "Mark ready to match", requiresDocuments: true },
    "needs-information": { status: "ready-to-match", label: "Mark ready to match", requiresDocuments: true },
    "ready-to-match": { status: "matches-found", label: "Confirm matches found" },
    "matches-found": { status: "application-in-progress", label: "Start property application" },
    "application-in-progress": { status: "submitted-to-property", label: "Mark submitted" },
    "submitted-to-property": { status: "waitlisted", label: "Mark waitlisted" },
    "waitlisted": { status: "housed", label: "Mark housed" },
    "housed": { status: "application-in-progress", label: "Reopen case" },
  };
  return transitions[status] || transitions.new;
}

function renderApplications() {
  renderMetrics();
  renderTable();
  renderCasePanel();
}

function updateApplication(id, updates, message) {
  const application = state.applications.find((item) => item.id === id);
  if (!application) return;
  Object.assign(application, updates);
  saveStoredState();
  renderApplications();
  showToast(message);
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function clearFilters() {
  state.statusGroup = "all";
  state.stage = "all";
  state.priority = "all";
  state.size = "all";
  state.bedrooms = "all";
  state.documents = "all";
  state.match = "all";
  state.search = "";
  document.getElementById("application-search").value = "";
  document.getElementById("priority-filter").value = "all";
  document.getElementById("size-filter").value = "all";
  document.getElementById("stage-filter").value = "all";
  document.getElementById("bedroom-filter").value = "all";
  document.getElementById("documents-filter").value = "all";
  document.getElementById("match-filter").value = "all";
  document.querySelectorAll(".status-tab").forEach((tab) => {
    const active = tab.dataset.status === "all";
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  renderApplications();
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && !dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && dialog.open) dialog.close();
}

function switchView(viewName) {
  document.querySelectorAll("[data-view-panel]").forEach((view) => view.classList.toggle("active", view.dataset.viewPanel === viewName));
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.view === viewName;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  const labels = { applications: "Housing Matching & Applications", map: "Site planning map", overview: "Program overview", outreach: "Outreach" };
  document.getElementById("breadcrumb-current").textContent = labels[viewName];
  document.querySelector(".sidebar").classList.remove("open");
  document.querySelector(".mobile-menu").setAttribute("aria-expanded", "false");
  if (viewName === "map") initializeMap();
}

function updateIntakePreview() {
  const form = document.getElementById("intake-form");
  const formData = new FormData(form);
  const gap = Number(formData.get("income")) - Number(formData.get("hlb"));
  document.getElementById("intake-eligibility-label").textContent = `Affordability gap: ${formatMoney(gap)} / year`;
  document.getElementById("intake-checks").textContent = "0/9";
}

function addApplication(form) {
  const formData = new FormData(form);
  const pumaSelect = form.elements.puma;
  const sequence = 230 + state.applications.filter((application) => application.id.startsWith("HA-LOCAL")).length + 1;
  const application = {
    id: `HA-LOCAL-${sequence}`,
    applicant: String(formData.get("applicant")).trim(),
    submitted: currentReviewDate().toISOString().slice(0, 10),
    status: "new",
    adults: Number(formData.get("adults")),
    children: Number(formData.get("children")),
    youngestChild: Number(formData.get("youngestChild")) || 18,
    income: Number(formData.get("income")),
    hlb: Number(formData.get("hlb")),
    housing: String(formData.get("housing")),
    bedroomNeed: Number(formData.get("bedrooms")),
    puma: String(formData.get("puma")),
    area: pumaSelect.options[pumaSelect.selectedIndex].text,
    language: String(formData.get("language")),
    contact: "Not recorded",
    channel: "Manual intake",
    reviewer: "Unassigned",
    documents: { identity: false, income: false, residency: false, household: false, housing: false, consent: false, assets: false, application: false, release: false },
    note: "",
  };
  state.applications.push(application);
  state.selectedId = application.id;
  clearFilters();
  saveStoredState();
  closeDialog("intake-dialog");
  form.reset();
  updateIntakePreview();
  showToast(`${application.applicant} was added to the application queue.`);
}

async function initializeMap() {
  if (state.mapLoaded) {
    if (window.Plotly) window.Plotly.Plots.resize(document.getElementById("map"));
    return;
  }
  state.mapLoaded = true;
  const statusElement = document.getElementById("map-status");
  statusElement.textContent = "Loading planning data and Census Bureau boundaries…";

  try {
    if (!window.Plotly) throw new Error("The map library did not load");
    const statsResponse = await fetch("data/puma_stats.json");
    if (!statsResponse.ok) throw new Error(`Planning data returned HTTP ${statsResponse.status}`);
    const statsData = await statsResponse.json();
    const pumas = statsData.pumas;
    const byCode = Object.fromEntries(pumas.map((puma) => [puma.puma_code, puma]));
    document.getElementById("stat-county-rate").textContent = `${statsData.county_summary.county_vulnerability_rate.toFixed(1)}%`;
    document.getElementById("stat-total-vuln").textContent = formatNumber(statsData.county_summary.total_vulnerable);
    document.getElementById("stat-total-hh").textContent = formatNumber(statsData.county_summary.total_households);

    const pumaCodes = pumas.map((puma) => puma.puma_code);
    const whereClause = `STATE='06' AND PUMA IN (${pumaCodes.map((code) => `'${code}'`).join(",")})`;
    const geoUrl = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/0/query"
      + `?where=${encodeURIComponent(whereClause)}&outFields=STATE,PUMA,BASENAME,NAME,GEOID&returnGeometry=true&outSR=4326&f=geojson`;
    const geoResponse = await fetch(geoUrl);
    if (!geoResponse.ok) throw new Error(`Census boundaries returned HTTP ${geoResponse.status}`);
    const geojson = await geoResponse.json();
    if (!geojson.features?.length) throw new Error("No Census boundaries were returned");
    const locations = geojson.features.map((feature) => feature.properties.PUMA);
    const values = locations.map((code) => byCode[code]?.vulnerability_rate ?? null);
    const hoverText = locations.map((code) => {
      const puma = byCode[code];
      if (!puma) return "No data";
      return `<b>${puma.puma_name}</b><br>PUMA ${puma.puma_code}<br><b>${puma.vulnerability_rate.toFixed(1)}%</b> priced out<br>${formatNumber(puma.n_vulnerable)} of ${formatNumber(puma.n_households)} households<br>Median income: ${formatMoney(puma.median_income)}<br>Modeled required income: ${formatMoney(puma.median_hlb_year)}`;
    });
    const trace = { type: "choroplethmapbox", geojson, locations, z: values, featureidkey: "properties.PUMA", colorscale: [[0, "#deecea"], [0.25, "#8fc9c3"], [0.5, "#f0b490"], [0.75, "#d56a3a"], [1, "#8f332f"]], zmin: 0, zmax: 70, marker: { line: { width: 1.1, color: "#ffffff" }, opacity: 0.88 }, text: hoverText, hoverinfo: "text", colorbar: { title: { text: "% priced out", side: "right" }, ticksuffix: "%", thickness: 13, len: 0.75 } };
    const layout = { mapbox: { style: "open-street-map", center: { lat: 33.02, lon: -116.9 }, zoom: 8.15 }, margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: "#ffffff" };
    await window.Plotly.newPlot("map", [trace], layout, { responsive: true, displayModeBar: false });
    statusElement.textContent = "Hover over an area to inspect modeled household need.";
    document.getElementById("map").on("plotly_hover", (event) => showMapDetail(event.points[0].location, byCode));
  } catch (error) {
    state.mapLoaded = false;
    statusElement.textContent = `${error.message}. Serve this folder over HTTP and check the network connection used for Census boundaries.`;
    statusElement.className = "error";
  }
}

function showMapDetail(code, byCode) {
  const puma = byCode[code];
  if (!puma) return;
  document.getElementById("detail-name").textContent = puma.puma_name;
  document.getElementById("detail-code").textContent = `PUMA ${puma.puma_code}`;
  document.getElementById("detail-vuln").textContent = `${puma.vulnerability_rate.toFixed(1)}%`;
  document.getElementById("detail-n").textContent = `${formatNumber(puma.n_vulnerable)} / ${formatNumber(puma.n_households)}`;
  document.getElementById("detail-income").textContent = formatMoney(puma.median_income);
  document.getElementById("detail-hlb").textContent = formatMoney(puma.median_hlb_year);
  document.getElementById("detail-gap").textContent = `${formatMoney(puma.median_gap_vulnerable)} / year`;
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => switchView(item.dataset.view)));
  document.querySelectorAll("[data-go-to]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.goTo)));
  document.querySelector(".mobile-menu").addEventListener("click", (event) => {
    const open = document.querySelector(".sidebar").classList.toggle("open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });

  document.getElementById("application-search").addEventListener("input", (event) => { state.search = event.target.value; renderApplications(); });
  document.getElementById("sort-applications").addEventListener("change", (event) => { state.sort = event.target.value; renderApplications(); });
  ["priority", "size", "stage", "bedroom", "documents", "match"].forEach((filter) => {
    document.getElementById(`${filter}-filter`).addEventListener("change", (event) => {
      const key = filter === "bedroom" ? "bedrooms" : filter;
      state[key] = event.target.value;
      renderApplications();
    });
  });
  document.getElementById("clear-filters").addEventListener("click", clearFilters);

  document.querySelectorAll(".status-tab").forEach((tab) => tab.addEventListener("click", () => {
    state.statusGroup = tab.dataset.status;
    document.querySelectorAll(".status-tab").forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    renderApplications();
  }));

  document.getElementById("application-rows").addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-application-id]");
    if (!row) return;
    state.selectedId = row.dataset.applicationId;
    renderApplications();
  });
  document.getElementById("application-rows").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("tr[data-application-id]");
    if (!row) return;
    event.preventDefault();
    state.selectedId = row.dataset.applicationId;
    renderApplications();
  });

  document.getElementById("case-panel").addEventListener("click", (event) => {
    const documentButton = event.target.closest("[data-document-key]");
    if (documentButton) {
      const application = state.applications.find((item) => item.id === state.selectedId);
      const key = documentButton.dataset.documentKey;
      updateApplication(state.selectedId, { documents: { ...application.documents, [key]: !application.documents[key] } }, `${documentLabels[key]} updated.`);
      return;
    }
    if (event.target.closest("[data-save-note]")) {
      updateApplication(state.selectedId, { note: document.getElementById("reviewer-note").value.trim() }, "Reviewer note saved.");
      return;
    }
    const panelAction = event.target.closest("[data-panel-action]");
    if (panelAction) {
      const action = panelAction.dataset.panelAction;
      if (action === "request-documents") updateApplication(state.selectedId, { status: "needs-information", reviewer: "Jordan Martinez" }, "Document request prepared and case moved to Needs information.");
      if (action === "view-matches") document.querySelector("[data-matches-section]")?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (action === "contact") showToast("Applicant contact options opened for staff review.");
      return;
    }
    const propertyButton = event.target.closest("[data-property-id]");
    if (propertyButton) {
      const property = state.properties.find((item) => item.id === propertyButton.dataset.propertyId);
      showToast(`${property.name} requirements are ready for staff review.`);
      return;
    }
    const stageButton = event.target.closest("[data-case-action]");
    if (stageButton && !stageButton.disabled) {
      const status = stageButton.dataset.caseAction;
      updateApplication(state.selectedId, { status, reviewer: "Jordan Martinez" }, `Case moved to ${statusLabels[status]}.`);
    }
  });

  document.getElementById("open-intake").addEventListener("click", () => { openDialog("intake-dialog"); updateIntakePreview(); });
  document.getElementById("open-method").addEventListener("click", () => openDialog("method-dialog"));
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.closeDialog)));
  document.querySelectorAll(".app-dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
  document.getElementById("intake-form").addEventListener("input", updateIntakePreview);
  document.getElementById("intake-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    addApplication(event.currentTarget);
  });
}

async function initialize() {
  bindEvents();
  try {
    const [applicationsResponse, propertiesResponse] = await Promise.all([fetch("data/applications.json"), fetch("data/properties.json")]);
    if (!applicationsResponse.ok || !propertiesResponse.ok) throw new Error("One or more data files could not be loaded");
    state.properties = await propertiesResponse.json();
    state.applications = loadStoredState(await applicationsResponse.json());
    state.selectedId = state.applications.find((application) => application.id === "HA-260211")?.id || getFilteredApplications()[0]?.id || null;
    renderApplications();
  } catch (error) {
    document.getElementById("queue-summary").textContent = "Application data could not be loaded.";
    document.getElementById("application-rows").innerHTML = `<tr><td colspan="7">Serve this folder over HTTP to load the demonstration data (${escapeHtml(error.message)}).</td></tr>`;
    document.getElementById("case-panel").innerHTML = `<div class="empty-state"><h3>Case data unavailable</h3><p>Check the local server and reload the page.</p></div>`;
  }
}

initialize();
