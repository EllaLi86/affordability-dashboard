const STORAGE_KEY = "housing-access-demo-state-v1";
const DEMO_START_DATE = new Date("2026-08-20T12:00:00");

const state = {
  applications: [],
  selectedId: null,
  status: "all",
  priority: "all",
  size: "all",
  search: "",
  sort: "priority",
  mapLoaded: false,
  toastTimer: null,
};

const statusLabels = {
  "new": "New",
  "in-review": "In review",
  "needs-info": "Needs info",
  "approved": "Approved",
};

const housingLabels = {
  "unhoused": "Currently unhoused",
  "eviction": "Eviction or move-out notice",
  "temporary": "Temporary / doubled up",
  "severe-burden": "Severe rent burden",
  "stable": "Stable housing",
};

const documentLabels = {
  identity: "Identity documentation",
  income: "Income verification",
  residency: "County residency",
  housing: "Housing situation evidence",
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

function calculatePriority(application) {
  const coverage = application.hlb > 0 ? application.income / application.hlb : 1;
  const financial = Math.round(clamp((1 - coverage) * 53.34, 0, 40));
  const housingScores = { "unhoused": 30, "eviction": 25, "temporary": 18, "severe-burden": 12, "stable": 0 };
  const housing = housingScores[application.housing] ?? 0;
  const householdSize = Number(application.adults) + Number(application.children);
  let household = 0;
  if (application.children > 0) household += 5;
  if (application.children > 0 && application.youngestChild <= 5) household += 5;
  if (application.adults === 1 && application.children > 0) household += 4;
  if (householdSize >= 5) household += 4;
  household = Math.min(household, 18);

  const submitted = new Date(`${application.submitted}T12:00:00`);
  const daysWaiting = Math.max(0, Math.floor((currentReviewDate() - submitted) / 86400000));
  const wait = Math.min(12, Math.floor(daysWaiting / 7));
  const total = Math.min(100, financial + housing + household + wait);
  const level = total >= 80 ? "urgent" : total >= 60 ? "high" : "standard";

  return { total, level, financial, housing, household, wait, coverage, daysWaiting };
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

function priorityLabel(level) {
  return level === "urgent" ? "Urgent" : level === "high" ? "High" : "Standard";
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
  const originalIds = new Set(state.applications.filter((application) => /^HA-260(184|191|196|203|207|211|215|218|220|223|227|229)$/.test(application.id)).map((application) => application.id));
  const changes = {};
  const added = [];

  state.applications.forEach((application) => {
    if (originalIds.has(application.id)) {
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

function getFilteredApplications() {
  const query = state.search.trim().toLowerCase();
  const filtered = state.applications.filter((application) => {
    const score = calculatePriority(application);
    const householdSize = application.adults + application.children;
    const statusMatch = state.status === "all" || application.status === state.status;
    const priorityMatch = state.priority === "all" || score.level === state.priority;
    const sizeMatch = state.size === "all"
      || (state.size === "1-3" && householdSize <= 3)
      || (state.size === "4-5" && householdSize >= 4 && householdSize <= 5)
      || (state.size === "6+" && householdSize >= 6);
    const searchMatch = !query || application.applicant.toLowerCase().includes(query) || application.id.toLowerCase().includes(query);
    return statusMatch && priorityMatch && sizeMatch && searchMatch;
  });

  return filtered.sort((a, b) => {
    if (state.sort === "oldest") return a.submitted.localeCompare(b.submitted);
    if (state.sort === "newest") return b.submitted.localeCompare(a.submitted);
    if (state.sort === "name") return a.applicant.localeCompare(b.applicant);
    return calculatePriority(b).total - calculatePriority(a).total || a.submitted.localeCompare(b.submitted);
  });
}

function renderMetrics() {
  const activeApplications = state.applications.filter((application) => application.status !== "approved");
  const urgentCount = activeApplications.filter((application) => calculatePriority(application).level === "urgent").length;
  const missingInfo = state.applications.filter((application) => application.status === "needs-info").length;
  const averageWait = activeApplications.length
    ? Math.round(activeApplications.reduce((sum, application) => sum + calculatePriority(application).daysWaiting, 0) / activeApplications.length)
    : 0;

  document.getElementById("application-metrics").innerHTML = `
    <article class="metric-card"><span>Active applications</span><strong>${activeApplications.length}</strong><small>${state.applications.length} total received</small></article>
    <article class="metric-card emphasis"><span>Urgent review</span><strong>${urgentCount}</strong><small>highest priority band</small></article>
    <article class="metric-card"><span>Waiting on information</span><strong>${missingInfo}</strong><small>applicant follow-up needed</small></article>
    <article class="metric-card"><span>Average wait</span><strong>${averageWait} days</strong><small>active applications</small></article>
  `;

  Object.keys(statusLabels).forEach((status) => {
    const element = document.getElementById(`count-${status}`);
    if (element) element.textContent = state.applications.filter((application) => application.status === status).length;
  });
  document.getElementById("count-all").textContent = state.applications.length;
  const newCount = state.applications.filter((application) => application.status === "new").length;
  document.getElementById("nav-new-count").textContent = newCount;
}

function renderTable() {
  const applications = getFilteredApplications();
  const rows = document.getElementById("application-rows");
  const empty = document.getElementById("empty-state");
  const summary = document.getElementById("queue-summary");

  if (applications.length && !applications.some((application) => application.id === state.selectedId)) {
    state.selectedId = applications[0].id;
  }

  summary.textContent = `${applications.length} of ${state.applications.length} applications shown`;
  empty.hidden = applications.length !== 0;
  rows.innerHTML = applications.map((application) => {
    const score = calculatePriority(application);
    const householdSize = application.adults + application.children;
    const isSelected = application.id === state.selectedId;
    const coveragePercent = Math.round(score.coverage * 100);
    return `
      <tr data-application-id="${escapeHtml(application.id)}" class="${isSelected ? "selected" : ""}" tabindex="0" aria-selected="${isSelected}">
        <td>
          <div class="applicant-cell">
            <span class="applicant-avatar">${escapeHtml(initials(application.applicant))}</span>
            <div><strong>${escapeHtml(application.applicant)}</strong><span>${escapeHtml(application.id)} · ${formatDate(application.submitted)}</span></div>
          </div>
        </td>
        <td><div class="cell-stack"><strong>${householdSize} people</strong><span>${application.children} ${application.children === 1 ? "child" : "children"} · ${householdSize <= 2 ? 1 : householdSize <= 3 ? 2 : householdSize <= 4 ? 3 : 4} BR</span></div></td>
        <td>
          <div class="coverage">
            <div class="coverage-row"><strong>${coveragePercent}%</strong><span>of modeled need</span></div>
            <div class="mini-bar"><i style="width:${clamp(coveragePercent, 0, 100)}%"></i></div>
          </div>
        </td>
        <td><span class="badge ${application.status}">${statusLabels[application.status]}</span></td>
        <td><div class="priority-cell"><span class="priority-score">${score.total}</span><span class="badge ${score.level}">${priorityLabel(score.level)}</span></div></td>
        <td><button class="row-arrow" type="button" tabindex="-1" aria-label="Open ${escapeHtml(application.applicant)} application">›</button></td>
      </tr>
    `;
  }).join("");

}

function renderCasePanel() {
  const panel = document.getElementById("case-panel");
  const application = state.applications.find((item) => item.id === state.selectedId);
  if (!application || !getFilteredApplications().some((item) => item.id === application.id)) {
    panel.innerHTML = `<div class="empty-state"><span aria-hidden="true">▤</span><h3>Select an application</h3><p>Applicant details will appear here.</p></div>`;
    return;
  }

  const score = calculatePriority(application);
  const householdSize = application.adults + application.children;
  const bedrooms = householdSize <= 2 ? 1 : householdSize <= 3 ? 2 : householdSize <= 4 ? 3 : 4;
  const completeDocuments = Object.values(application.documents).every(Boolean);
  const hasDecisionNote = Boolean(application.note && application.note.trim());
  const primaryAction = application.status === "approved" ? "Return to review" : application.status === "new" ? "Start review" : "Mark approved";
  const primaryActionType = application.status === "approved" ? "review" : application.status === "new" ? "review" : "approve";
  const approveDisabled = primaryActionType === "approve" && (!completeDocuments || !hasDecisionNote);

  panel.innerHTML = `
    <div class="case-panel-inner">
      <div class="case-head">
        <div class="case-head-top">
          <div><h2>${escapeHtml(application.applicant)}</h2><p>${escapeHtml(application.id)} · Submitted ${formatDate(application.submitted)}</p></div>
          <span class="score-ring" aria-label="Priority score ${score.total} out of 100">${score.total}</span>
        </div>
        <div class="case-badges"><span class="badge ${application.status}">${statusLabels[application.status]}</span><span class="badge ${score.level}">${priorityLabel(score.level)} priority</span></div>
      </div>

      <div class="case-scroll">
        <section class="case-section">
          <h3>Household snapshot</h3>
          <div class="fact-grid">
            <div class="fact"><span>Household</span><strong>${householdSize} people</strong></div>
            <div class="fact"><span>Unit need</span><strong>${bedrooms} bedrooms</strong></div>
            <div class="fact"><span>Composition</span><strong>${application.adults} ${application.adults === 1 ? "adult" : "adults"}, ${application.children} ${application.children === 1 ? "child" : "children"}</strong></div>
            <div class="fact"><span>Youngest child</span><strong>${application.children ? `${application.youngestChild} years` : "—"}</strong></div>
            <div class="fact"><span>Annual income</span><strong>${formatMoney(application.income)}</strong></div>
            <div class="fact"><span>Modeled HLB</span><strong>${formatMoney(application.hlb)}</strong></div>
            <div class="fact"><span>Housing</span><strong>${housingLabels[application.housing]}</strong></div>
            <div class="fact"><span>Area</span><strong>${escapeHtml(application.area)}</strong></div>
            <div class="fact"><span>Language</span><strong>${escapeHtml(application.language)}</strong></div>
            <div class="fact"><span>Contact</span><strong>${escapeHtml(application.contact)}</strong></div>
          </div>
        </section>

        <section class="case-section">
          <h3>Why this review order</h3>
          <div class="score-explainer">This score orders the queue; it does not determine eligibility or approve an application.</div>
          ${scoreRow("Financial gap", score.financial, 40)}
          ${scoreRow("Housing instability", score.housing, 30)}
          ${scoreRow("Household needs", score.household, 18)}
          ${scoreRow("Time waiting", score.wait, 12)}
          <button class="method-link" type="button" data-open-method>Read the complete scoring method</button>
        </section>

        <section class="case-section">
          <h3>Documents</h3>
          <div class="document-list">
            ${Object.entries(application.documents).map(([key, complete]) => `
              <button class="document-item document-toggle" type="button" data-document-key="${key}" aria-pressed="${complete}">
                <span class="document-status ${complete ? "complete" : "missing"}">${complete ? "✓" : "!"}</span>
                <span>${documentLabels[key]}</span>
                <span class="badge ${complete ? "approved" : "needs-info"}">${complete ? "Verified" : "Mark received"}</span>
              </button>
            `).join("")}
          </div>
        </section>

        <section class="case-section">
          <h3>Reviewer note</h3>
          <textarea class="note-box" id="reviewer-note" placeholder="Record facts checked and the reason for the decision…">${escapeHtml(application.note || "")}</textarea>
          <div class="note-actions"><button class="text-button" type="button" data-save-note>Save note</button></div>
        </section>

        <section class="case-section">
          <h3>Record details</h3>
          <div class="fact-grid">
            <div class="fact"><span>Assigned reviewer</span><strong>${escapeHtml(application.reviewer)}</strong></div>
            <div class="fact"><span>Intake channel</span><strong>${escapeHtml(application.channel)}</strong></div>
            <div class="fact"><span>Days waiting</span><strong>${score.daysWaiting}</strong></div>
            <div class="fact"><span>Income coverage</span><strong>${Math.round(score.coverage * 100)}%</strong></div>
          </div>
        </section>
      </div>

      <div class="case-actions">
        <button class="secondary-button" type="button" data-case-action="needs-info">Request info</button>
        <button class="primary-button" type="button" data-case-action="${primaryActionType}" ${approveDisabled ? `disabled title="Complete all documents and save a decision note first"` : ""}>${primaryAction}</button>
      </div>
    </div>
  `;
}

function scoreRow(label, value, maximum) {
  return `<div class="score-row"><span>${label}</span><div class="mini-bar"><i style="width:${Math.round(value / maximum * 100)}%"></i></div><strong>${value} / ${maximum}</strong></div>`;
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
  state.status = "all";
  state.priority = "all";
  state.size = "all";
  state.search = "";
  document.getElementById("application-search").value = "";
  document.getElementById("priority-filter").value = "all";
  document.getElementById("size-filter").value = "all";
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

  const labels = { applications: "Applications", map: "Site planning map", overview: "Program overview", outreach: "Outreach" };
  document.getElementById("breadcrumb-current").textContent = labels[viewName];
  document.querySelector(".sidebar").classList.remove("open");
  document.querySelector(".mobile-menu").setAttribute("aria-expanded", "false");
  if (viewName === "map") initializeMap();
}

function updateIntakePreview() {
  const form = document.getElementById("intake-form");
  const formData = new FormData(form);
  const preview = {
    adults: Number(formData.get("adults")),
    children: Number(formData.get("children")),
    youngestChild: Number(formData.get("youngestChild")) || 18,
    income: Number(formData.get("income")),
    hlb: Number(formData.get("hlb")),
    housing: formData.get("housing"),
    submitted: currentReviewDate().toISOString().slice(0, 10),
  };
  const score = calculatePriority(preview);
  document.getElementById("intake-score").textContent = score.total;
  document.getElementById("intake-priority-label").textContent = `${priorityLabel(score.level)} priority`;
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
    puma: String(formData.get("puma")),
    area: pumaSelect.options[pumaSelect.selectedIndex].text,
    language: String(formData.get("language")),
    contact: "Not recorded",
    channel: "Manual intake",
    reviewer: "Unassigned",
    documents: { identity: false, income: false, residency: false, housing: false },
    note: "",
  };

  state.applications.push(application);
  state.selectedId = application.id;
  clearFilters();
  saveStoredState();
  closeDialog("intake-dialog");
  form.reset();
  updateIntakePreview();
  showToast(`${application.applicant} was added to the review queue.`);
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

    const trace = {
      type: "choroplethmapbox",
      geojson,
      locations,
      z: values,
      featureidkey: "properties.PUMA",
      colorscale: [[0, "#deecea"], [0.25, "#8fc9c3"], [0.5, "#f0b490"], [0.75, "#d56a3a"], [1, "#8f332f"]],
      zmin: 0,
      zmax: 70,
      marker: { line: { width: 1.1, color: "#ffffff" }, opacity: 0.88 },
      text: hoverText,
      hoverinfo: "text",
      colorbar: { title: { text: "% priced out", side: "right" }, ticksuffix: "%", thickness: 13, len: 0.75 },
    };

    const layout = {
      mapbox: { style: "open-street-map", center: { lat: 33.02, lon: -116.9 }, zoom: 8.15 },
      margin: { l: 0, r: 0, t: 0, b: 0 },
      paper_bgcolor: "#ffffff",
    };

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
  document.getElementById("priority-filter").addEventListener("change", (event) => { state.priority = event.target.value; renderApplications(); });
  document.getElementById("size-filter").addEventListener("change", (event) => { state.size = event.target.value; renderApplications(); });
  document.getElementById("clear-filters").addEventListener("click", clearFilters);

  document.querySelectorAll(".status-tab").forEach((tab) => tab.addEventListener("click", () => {
    state.status = tab.dataset.status;
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
    if (event.target.closest("[data-open-method]")) openDialog("method-dialog");
    const documentButton = event.target.closest("[data-document-key]");
    if (documentButton) {
      const application = state.applications.find((item) => item.id === state.selectedId);
      const key = documentButton.dataset.documentKey;
      const documents = { ...application.documents, [key]: !application.documents[key] };
      updateApplication(state.selectedId, { documents }, `${documentLabels[key]} updated.`);
      return;
    }
    if (event.target.closest("[data-save-note]")) {
      const note = document.getElementById("reviewer-note").value.trim();
      updateApplication(state.selectedId, { note }, "Reviewer note saved.");
    }
    const actionButton = event.target.closest("[data-case-action]");
    if (!actionButton || actionButton.disabled) return;
    const action = actionButton.dataset.caseAction;
    if (action === "needs-info") updateApplication(state.selectedId, { status: "needs-info", reviewer: "Jordan Martinez" }, "Application moved to Needs info.");
    if (action === "review") updateApplication(state.selectedId, { status: "in-review", reviewer: "Jordan Martinez" }, "Application moved to In review.");
    if (action === "approve") updateApplication(state.selectedId, { status: "approved", reviewer: "Jordan Martinez" }, "Application marked approved for unit matching.");
  });

  document.getElementById("open-intake").addEventListener("click", () => { openDialog("intake-dialog"); updateIntakePreview(); });
  document.getElementById("open-method").addEventListener("click", () => openDialog("method-dialog"));
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.closeDialog)));
  document.querySelectorAll(".app-dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));
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
    const response = await fetch("data/applications.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const applications = await response.json();
    state.applications = loadStoredState(applications);
    state.selectedId = getFilteredApplications()[0]?.id || null;
    renderApplications();
  } catch (error) {
    document.getElementById("queue-summary").textContent = "Applications could not be loaded.";
    document.getElementById("application-rows").innerHTML = `<tr><td colspan="6">Serve this folder over HTTP to load the demonstration application data (${escapeHtml(error.message)}).</td></tr>`;
    document.getElementById("case-panel").innerHTML = `<div class="empty-state"><h3>Application data unavailable</h3><p>Check the local server and reload the page.</p></div>`;
  }
}

initialize();
