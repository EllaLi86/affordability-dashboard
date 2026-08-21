const STORAGE_KEY = "housing-access-demo-state-v3";
const OUTREACH_STORAGE_KEY = "housing-access-outreach-demo-state-v1";
const DEMO_START_DATE = new Date("2026-08-20T12:00:00");

const state = {
  applications: [],
  properties: [],
  buyerProfiles: [],
  mortgagePrograms: [],
  selectedId: null,
  selectedBuyerId: "HA-260211",
  statusGroup: "all",
  stage: "all",
  priority: "all",
  size: "all",
  bedrooms: "all",
  documents: "all",
  match: "all",
  search: "",
  sort: "priority",
  buyerSearch: "",
  buyerAmiFilter: "all",
  buyerReadinessFilter: "all",
  planningRate: 6.5,
  outreachData: null,
  outreachSearch: "",
  outreachTier: "market-first",
  outreachSize: "all",
  outreachArea: "all",
  outreachChannel: "all",
  outreachSort: "fit",
  selectedOutreachId: null,
  outreachStatuses: {},
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

function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
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

function getBuyerReadiness(record) {
  if (!record.profile.educationComplete) return "needs-counseling";
  if (record.profile.preapproval !== "complete") return "needs-preapproval";
  if (!record.application.documents?.income) return "needs-documents";
  return "match-ready";
}

function buyerReadinessLabel(readiness) {
  const labels = {
    "match-ready": "Match ready",
    "needs-counseling": "Needs counseling",
    "needs-preapproval": "Needs preapproval",
    "needs-documents": "Needs documents",
  };
  return labels[readiness] || "Needs review";
}

function getLinkedBuyerRecords() {
  return state.buyerProfiles
    .map((profile) => ({ profile, application: state.applications.find((application) => application.id === profile.applicationId) }))
    .filter((record) => record.application?.financingPath === "mortgage-matching");
}

function getBuyerRecords() {
  const query = state.buyerSearch.trim().toLowerCase();
  return getLinkedBuyerRecords()
    .filter((record) => {
      const ami = record.profile.amiPercent;
      const amiMatch = state.buyerAmiFilter === "all"
        || (state.buyerAmiFilter === "80-120" && ami >= 80 && ami <= 120)
        || (state.buyerAmiFilter === "120-150" && ami > 120 && ami <= 150)
        || (state.buyerAmiFilter === "outside-target" && (ami < 80 || ami > 150));
      const readiness = getBuyerReadiness(record);
      const readinessMatch = state.buyerReadinessFilter === "all"
        || readiness === state.buyerReadinessFilter
        || (state.buyerReadinessFilter === "needs-preapproval" && readiness === "needs-documents");
      const searchMatch = !query
        || record.application.applicant.toLowerCase().includes(query)
        || record.application.id.toLowerCase().includes(query);
      return amiMatch && readinessMatch && searchMatch;
    })
    .sort((a, b) => {
      const order = { "match-ready": 0, "needs-preapproval": 1, "needs-documents": 2, "needs-counseling": 3 };
      return order[getBuyerReadiness(a)] - order[getBuyerReadiness(b)] || a.profile.amiPercent - b.profile.amiPercent;
    });
}

function calculateBuyerCapacity(record) {
  const { application, profile } = record;
  const grossMonthlyIncome = application.income / 12;
  const planningHousingBudget = grossMonthlyIncome * 0.30;
  const principalAndInterestBudget = planningHousingBudget * 0.72;
  const monthlyRate = state.planningRate / 100 / 12;
  const payments = 360;
  const loanCapacity = monthlyRate > 0
    ? principalAndInterestBudget * (1 - Math.pow(1 + monthlyRate, -payments)) / monthlyRate
    : principalAndInterestBudget * payments;
  const estimatedPriceCapacity = Math.max(0, loanCapacity + profile.savings);
  const purchaseGap = Math.max(0, profile.targetPrice - estimatedPriceCapacity);
  const estimatedUpfrontNeed = profile.targetPrice * 0.055;
  const upfrontCashGap = Math.max(0, estimatedUpfrontNeed - profile.savings);
  const monthlyDebtRatio = grossMonthlyIncome ? profile.monthlyDebt / grossMonthlyIncome * 100 : 0;
  return { grossMonthlyIncome, planningHousingBudget, loanCapacity, estimatedPriceCapacity, purchaseGap, estimatedUpfrontNeed, upfrontCashGap, monthlyDebtRatio };
}

function matchMortgageProgram(record, program) {
  const { profile } = record;
  const incomeFits = (program.amiMin == null || profile.amiPercent >= program.amiMin)
    && (program.amiMax == null || profile.amiPercent <= program.amiMax);
  const firstTimeFits = !program.firstTimeRequired || profile.firstTimeBuyer;
  let location = "pass";
  if (["city-san-diego", "county-participating", "chula-vista"].includes(program.geography)) location = "verify";
  const educationNeeded = program.requirements.some((requirement) => requirement.toLowerCase().includes("education")) && !profile.educationComplete;
  const preapprovalNeeded = profile.preapproval !== "complete" && program.id !== "fha-insured";

  let result;
  let reason;
  if (!firstTimeFits) {
    result = "outside";
    reason = "First-time buyer requirement is not currently met.";
  } else if (!incomeFits) {
    result = "outside";
    reason = program.amiMax == null ? "Verify the program's current income limit." : `Applicant is outside the displayed ${program.amiMin}%–${program.amiMax}% AMI range.`;
  } else if (location === "verify") {
    result = "verify";
    reason = "Income profile may fit; verify the exact property address and participating jurisdiction.";
  } else if (educationNeeded || preapprovalNeeded) {
    result = "prepare";
    const steps = [educationNeeded ? "homebuyer education" : null, preapprovalNeeded ? "participating-lender preapproval" : null].filter(Boolean);
    reason = `Profile fits the displayed range; complete ${steps.join(" and ")} before program submission.`;
  } else {
    result = "strong";
    reason = "Strong preliminary match based on AMI band, first-time buyer status, location, and readiness information.";
  }

  let assistanceEstimate = null;
  if (program.assistanceValue) assistanceEstimate = program.assistanceValue;
  if (program.assistancePercent) assistanceEstimate = profile.targetPrice * program.assistancePercent / 100;
  if (program.assistanceCap && assistanceEstimate) assistanceEstimate = Math.min(assistanceEstimate, program.assistanceCap);
  return { program, result, reason, assistanceEstimate };
}

function getMortgageProgramMatches(record) {
  const order = { strong: 0, prepare: 1, verify: 2, outside: 3 };
  return state.mortgagePrograms
    .map((program) => matchMortgageProgram(record, program))
    .sort((a, b) => order[a.result] - order[b.result]);
}

function mortgageMatchLabel(result) {
  const labels = { strong: "Strong preliminary match", prepare: "Preparation needed", verify: "Location verification", outside: "Outside displayed range" };
  return labels[result];
}

function renderMortgageMetrics() {
  const records = getLinkedBuyerRecords();
  const firstTime = records.filter((record) => record.profile.firstTimeBuyer).length;
  const matchReady = records.filter((record) => getBuyerReadiness(record) === "match-ready").length;
  const counseling = records.filter((record) => !record.profile.educationComplete).length;
  const medianGapValues = records.map((record) => calculateBuyerCapacity(record).purchaseGap).sort((a, b) => a - b);
  const medianGap = medianGapValues.length ? medianGapValues[Math.floor(medianGapValues.length / 2)] : 0;
  document.getElementById("mortgage-metrics").innerHTML = `
    <article class="metric-card"><span>Linked Mortgage Cases</span><strong>${records.length}</strong><small>of ${state.applications.length} program applications</small></article>
    <article class="metric-card emphasis"><span>First-Time Buyers</span><strong>${firstTime}</strong><small>reported buyer status</small></article>
    <article class="metric-card"><span>Assistance Match-Ready</span><strong>${matchReady}</strong><small>education, documents, and preapproval</small></article>
    <article class="metric-card"><span>Median Purchase Gap</span><strong>${formatMoney(medianGap)}</strong><small>planning estimate at ${state.planningRate.toFixed(2)}%</small></article>
  `;
  document.getElementById("mortgage-count").textContent = records.length;
  document.getElementById("buyer-list-summary").textContent = `${getBuyerRecords().length} of ${records.length} buyer profiles`;
  return counseling;
}

function renderBuyerList() {
  const records = getBuyerRecords();
  if (records.length && !records.some((record) => record.application.id === state.selectedBuyerId)) {
    state.selectedBuyerId = records[0].application.id;
  }
  if (!records.length) state.selectedBuyerId = null;
  document.getElementById("buyer-list").innerHTML = records.length ? records.map((record) => {
    const readiness = getBuyerReadiness(record);
    const capacity = calculateBuyerCapacity(record);
    const selected = record.application.id === state.selectedBuyerId;
    return `
      <button class="buyer-row ${selected ? "selected" : ""}" type="button" data-buyer-id="${escapeHtml(record.application.id)}" aria-pressed="${selected}">
        <span class="applicant-avatar">${escapeHtml(initials(record.application.applicant))}</span>
        <span class="buyer-row-main"><strong>${escapeHtml(record.application.applicant)}</strong><small>${escapeHtml(record.application.id)} · ${statusLabels[record.application.status]}</small><span class="buyer-gap">${record.profile.amiPercent}% AMI · ${formatMoney(capacity.purchaseGap)} purchase gap</span></span>
        <span class="badge buyer-${readiness}">${buyerReadinessLabel(readiness)}</span>
      </button>
    `;
  }).join("") : `<div class="empty-state compact-empty"><h3>No buyers found</h3><p>Change the AMI or readiness filter.</p></div>`;
}

function renderReadinessItem(label, complete, detail) {
  return `<div class="readiness-item"><span class="readiness-check ${complete ? "complete" : "pending"}">${complete ? "✓" : "!"}</span><div><strong>${label}</strong><small>${detail}</small></div><span>${complete ? "Complete" : "Next step"}</span></div>`;
}

function renderMortgageProgramCard(match) {
  const { program } = match;
  return `
    <article class="mortgage-program-card ${match.result}">
      <div class="mortgage-program-head"><div><p>${escapeHtml(program.agency)}</p><h3>${escapeHtml(program.name)}</h3></div><span class="badge mortgage-${match.result}">${mortgageMatchLabel(match.result)}</span></div>
      <p class="program-assistance">${escapeHtml(program.assistance)}</p>
      ${match.assistanceEstimate ? `<div class="assistance-estimate"><span>Potential assistance at target price</span><strong>Up to ${formatMoney(match.assistanceEstimate)}</strong></div>` : ""}
      <p class="program-reason">${escapeHtml(match.reason)}</p>
      <div class="program-tags">${program.requirements.map((requirement) => `<span>${escapeHtml(requirement)}</span>`).join("")}</div>
      <div class="program-card-foot"><span>${escapeHtml(program.funding)}</span><a href="${escapeHtml(program.source)}" target="_blank" rel="noopener">Official requirements ↗</a></div>
    </article>
  `;
}

function renderMortgageDetail() {
  const application = state.applications.find((item) => item.id === state.selectedBuyerId);
  const profile = application?.financingPath === "mortgage-matching"
    ? state.buyerProfiles.find((item) => item.applicationId === state.selectedBuyerId)
    : null;
  const detail = document.getElementById("mortgage-buyer-detail");
  if (!profile || !application) {
    detail.innerHTML = `<div class="empty-state"><h3>Select a buyer profile</h3><p>Affordability planning and program matches will appear here.</p></div>`;
    return;
  }
  const record = { profile, application };
  const capacity = calculateBuyerCapacity(record);
  const readiness = getBuyerReadiness(record);
  const programMatches = getMortgageProgramMatches(record);
  const nextAction = !application.documents?.income
    ? { title: "Verify household income", detail: "Program and lender comparisons require current income evidence.", action: "Request income documents" }
    : !profile.educationComplete
      ? { title: "Enroll in homebuyer education", detail: "Local and CalHFA assistance programs commonly require education or counseling.", action: "Start counseling referral" }
      : profile.preapproval !== "complete"
        ? { title: "Complete participating-lender preapproval", detail: "Confirm the first-mortgage amount before relying on assistance estimates.", action: "Request preapproval" }
        : { title: "Verify target property jurisdiction", detail: "Confirm the exact address, purchase price, property type, and available program funding.", action: "Review program checklist" };
  const bridgePercent = Math.round(clamp(capacity.estimatedPriceCapacity / profile.targetPrice * 100, 0, 100));

  detail.innerHTML = `
    <div class="mortgage-buyer-head">
      <div><p class="eyebrow">LINKED PROGRAM APPLICATION</p><h2>${escapeHtml(application.applicant)}</h2><p>${escapeHtml(application.id)} · ${statusLabels[application.status]} · ${householdSize(application)}-person household · ${profile.amiPercent}% AMI</p></div>
      <div class="buyer-head-actions"><div class="buyer-head-badges"><span class="badge buyer-${readiness}">${buyerReadinessLabel(readiness)}</span><span class="badge first-buyer">${profile.firstTimeBuyer ? "First-time buyer" : "Repeat buyer"}</span></div><button class="text-button" type="button" data-return-application>← View application</button></div>
    </div>

    <section class="mortgage-next-action">
      <div><p class="eyebrow">NEXT RECOMMENDED ACTION</p><h3>${escapeHtml(nextAction.title)}</h3><p>${escapeHtml(nextAction.detail)}</p></div>
      <button class="primary-button" type="button" data-mortgage-action>${escapeHtml(nextAction.action)}</button>
    </section>

    <div class="mortgage-detail-grid">
      <section class="mortgage-card affordability-bridge">
        <div class="mortgage-card-head"><div><p class="eyebrow">AFFORDABILITY BRIDGE</p><h3>What assistance needs to solve</h3></div><label>Planning rate <span><input id="planning-rate" type="number" min="1" max="15" step="0.125" value="${state.planningRate}">%</span></label></div>
        <div class="bridge-amounts">
          <div><span>Target home price</span><strong>${formatMoney(profile.targetPrice)}</strong></div>
          <div><span>Planning price capacity</span><strong>${formatMoney(capacity.estimatedPriceCapacity)}</strong></div>
          <div class="bridge-gap"><span>Estimated purchase gap</span><strong>${formatMoney(capacity.purchaseGap)}</strong></div>
          <div><span>Estimated upfront cash gap</span><strong>${formatMoney(capacity.upfrontCashGap)}</strong></div>
        </div>
        <div class="bridge-bar" aria-label="Planning capacity covers ${bridgePercent}% of target price"><i style="width:${bridgePercent}%"></i></div>
        <div class="bridge-caption"><span>${bridgePercent}% planning capacity</span><span>${100 - bridgePercent}% bridge needed</span></div>
        <p class="calculation-note">Staff planning estimate only: uses 30% of gross income as a housing budget, reserves 28% for taxes, insurance, and association costs, assumes a 30-year term, and adds recorded savings. It is not a lender quote or preapproval.</p>
      </section>

      <section class="mortgage-card buyer-financial-card">
        <p class="eyebrow">BUYER SNAPSHOT</p><h3>Income is viable; market access is the gap</h3>
        <div class="buyer-financial-grid">
          <div><span>Annual income</span><strong>${formatMoney(application.income)}</strong></div><div><span>AMI band</span><strong>${profile.amiPercent}%</strong></div><div><span>Available savings</span><strong>${formatMoney(profile.savings)}</strong></div><div><span>Monthly debt</span><strong>${formatMoney(profile.monthlyDebt)}</strong></div><div><span>Credit band</span><strong>${escapeHtml(profile.creditBand)}</strong></div><div><span>Employment history</span><strong>${profile.employmentYears} years</strong></div>
        </div>
        <p class="calculation-note">Credit band is used only to guide counseling and lender referral. The dashboard does not make a credit or underwriting decision.</p>
      </section>
    </div>

    <section class="mortgage-card readiness-card">
      <div class="section-heading-row"><div><p class="eyebrow">READINESS CHECKLIST</p><h3>Before program or lender submission</h3></div><span>${[profile.firstTimeBuyer, application.documents?.income, profile.educationComplete, profile.preapproval === "complete"].filter(Boolean).length}/4 core steps</span></div>
      <div class="readiness-list">
        ${renderReadinessItem("First-time buyer status", profile.firstTimeBuyer, profile.firstTimeBuyer ? "Reported no home ownership in the prior three-year period; verify program definition." : "Review program exceptions and ownership history.")}
        ${renderReadinessItem("Income evidence", Boolean(application.documents?.income), application.documents?.income ? "Current income evidence is recorded." : "Request current income verification.")}
        ${renderReadinessItem("Homebuyer education", profile.educationComplete, profile.educationComplete ? "Completion recorded." : "Refer to an approved education or counseling provider.")}
        ${renderReadinessItem("Participating-lender preapproval", profile.preapproval === "complete", profile.preapproval === "complete" ? "Preapproval recorded; confirm expiration and terms." : profile.preapproval === "in-progress" ? "Preapproval is in progress." : "Preapproval has not started.")}
      </div>
    </section>

    <section class="mortgage-program-section">
      <div class="section-heading-row"><div><p class="eyebrow">PROGRAM MATCHES</p><h2>Government-backed mortgage and purchase assistance</h2><p>Ordered by preliminary fit. Staff must verify current funding and official guidelines.</p></div><span>${programMatches.filter((match) => match.result !== "outside").length} possible</span></div>
      <div class="mortgage-program-grid">${programMatches.map(renderMortgageProgramCard).join("")}</div>
    </section>
  `;
}

function renderMortgageWorkspace() {
  renderMortgageMetrics();
  renderBuyerList();
  renderMortgageDetail();
}

const outreachPlanStages = {
  "not-planned": { label: "Not planned", action: "Add to campaign" },
  "campaign-ready": { label: "Campaign ready", action: "Assign partner" },
  "partner-assigned": { label: "Partner assigned", action: "Reset plan" },
};

function outreachTierLabel(tier) {
  return tier === "market-first" ? "Market first" : "Consider next";
}

function loadOutreachStatuses() {
  try {
    const stored = JSON.parse(localStorage.getItem(OUTREACH_STORAGE_KEY) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch (_error) {
    return {};
  }
}

function saveOutreachStatuses() {
  localStorage.setItem(OUTREACH_STORAGE_KEY, JSON.stringify(state.outreachStatuses));
}

function getOutreachStatus(id) {
  return state.outreachStatuses[id] || "not-planned";
}

function getFilteredOutreachHouseholds() {
  if (!state.outreachData) return [];
  const query = state.outreachSearch.trim().toLowerCase();
  const tierOrder = { "market-first": 0, "consider-next": 1 };
  const households = state.outreachData.households.filter((household) => {
    const searchMatch = !query
      || household.id.toLowerCase().includes(query)
      || household.pumaName.toLowerCase().includes(query)
      || household.tract.includes(query)
      || household.puma.includes(query);
    return searchMatch
      && (state.outreachTier === "all" || household.tier === state.outreachTier)
      && (state.outreachSize === "all" || household.householdSize === Number(state.outreachSize))
      && (state.outreachArea === "all" || household.puma === state.outreachArea)
      && (state.outreachChannel === "all" || household.recommendedChannel === state.outreachChannel);
  });

  return households.sort((a, b) => {
    if (state.outreachSort === "gap") return a.annualGap - b.annualGap || a.id.localeCompare(b.id);
    if (state.outreachSort === "income") return b.income - a.income || a.id.localeCompare(b.id);
    if (state.outreachSort === "area") return a.pumaName.localeCompare(b.pumaName) || a.id.localeCompare(b.id);
    return tierOrder[a.tier] - tierOrder[b.tier]
      || b.coveragePercent - a.coveragePercent
      || a.annualGap - b.annualGap
      || a.id.localeCompare(b.id);
  });
}

function initializeOutreachFilters() {
  if (!state.outreachData) return;
  const areaSelect = document.getElementById("outreach-area-filter");
  areaSelect.innerHTML = '<option value="all">All planning areas</option>'
    + state.outreachData.areas
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((area) => `<option value="${escapeHtml(area.puma)}">${escapeHtml(area.name)}</option>`)
      .join("");
  const channels = [...new Set(state.outreachData.households.map((household) => household.recommendedChannel))].sort();
  document.getElementById("outreach-channel-filter").innerHTML = '<option value="all">All channels</option>'
    + channels.map((channel) => `<option value="${escapeHtml(channel)}">${escapeHtml(channel)}</option>`).join("");
}

function renderOutreachMetrics() {
  if (!state.outreachData) return;
  const { summary } = state.outreachData;
  const planned = Object.values(state.outreachStatuses).filter((status) => status !== "not-planned").length;
  document.getElementById("outreach-metrics").innerHTML = `
    <article class="metric-card emphasis"><span>Market-First Audience</span><strong>${formatNumber(summary.marketFirst)}</strong><small>modeled 4–5-person households</small></article>
    <article class="metric-card"><span>Median Audience Income</span><strong>${formatMoney(summary.medianMarketFirstIncome)}</strong><small>low–middle planning segment</small></article>
    <article class="metric-card"><span>Median Affordability Gap</span><strong>${formatMoney(summary.medianMarketFirstGap)}</strong><small>income below modeled HLB</small></article>
    <article class="metric-card"><span>Campaign Plan</span><strong>${planned}</strong><small>representative rows queued locally</small></article>
  `;
  document.getElementById("outreach-count").textContent = formatCompactNumber(summary.marketFirst);
}

function renderOutreachRows() {
  const households = getFilteredOutreachHouseholds();
  const total = state.outreachData?.households.length || 0;
  document.getElementById("outreach-summary").textContent = `${households.length} of ${total} representative synthetic households shown`;
  document.getElementById("outreach-empty").hidden = households.length !== 0;
  if (households.length && !households.some((household) => household.id === state.selectedOutreachId)) {
    state.selectedOutreachId = households[0].id;
  }
  if (!households.length) state.selectedOutreachId = null;

  document.getElementById("outreach-rows").innerHTML = households.map((household) => {
    const selected = household.id === state.selectedOutreachId;
    const statusKey = getOutreachStatus(household.id);
    const status = outreachPlanStages[statusKey];
    return `
      <tr class="${selected ? "selected" : ""}" data-outreach-id="${escapeHtml(household.id)}" tabindex="0" aria-selected="${selected}">
        <td><div class="outreach-id-cell"><strong>${escapeHtml(household.id)}</strong><span>Census tract ${escapeHtml(household.tract.slice(-6))}</span><span class="badge outreach-${household.tier}">${outreachTierLabel(household.tier)}</span></div></td>
        <td><div class="cell-stack"><strong>${household.householdSize} people</strong><span>${household.adults} adults · ${household.children} children</span></div></td>
        <td><div class="cell-stack outreach-income-cell"><strong>${formatMoney(household.income)}</strong><span>${household.coveragePercent}% of modeled budget</span><small>${formatMoney(household.annualGap)} annual gap</small></div></td>
        <td><div class="cell-stack outreach-area-cell"><strong>${escapeHtml(household.pumaName)}</strong><span>PUMA ${escapeHtml(household.puma)}</span></div></td>
        <td><div class="channel-cell"><strong>${escapeHtml(household.recommendedChannel)}</strong><span>Broad community outreach</span></div></td>
        <td><div class="campaign-cell"><span class="badge campaign-${statusKey}">${status.label}</span><button class="text-button" type="button" data-outreach-action data-outreach-id="${escapeHtml(household.id)}">${status.action}</button></div></td>
      </tr>
    `;
  }).join("");
}

function renderOutreachAreas() {
  if (!state.outreachData) return;
  const areas = state.outreachData.areas.slice(0, 5);
  const maxAudience = Math.max(...areas.map((area) => area.marketFirst), 1);
  document.getElementById("outreach-areas").innerHTML = areas.map((area, index) => `
    <button type="button" class="outreach-area-row" data-outreach-area="${escapeHtml(area.puma)}">
      <span class="area-rank">${index + 1}</span>
      <span class="area-row-main"><strong>${escapeHtml(area.name)}</strong><small>${formatNumber(area.marketFirst)} modeled households · ${area.shareOfMarketFirst}% of audience</small><i><b style="width:${Math.round(area.marketFirst / maxAudience * 100)}%"></b></i></span>
    </button>
  `).join("");
}

function renderOutreachDetail() {
  const detail = document.getElementById("outreach-detail");
  const household = state.outreachData?.households.find((item) => item.id === state.selectedOutreachId);
  if (!household) {
    detail.innerHTML = '<div class="empty-state compact-empty"><h3>Select a household pattern</h3><p>Audience fit and channel guidance will appear here.</p></div>';
    return;
  }
  const statusKey = getOutreachStatus(household.id);
  const status = outreachPlanStages[statusKey];
  detail.innerHTML = `
    <div class="outreach-detail-head"><div><p class="eyebrow">SELECTED SYNTHETIC HOUSEHOLD</p><h2>${escapeHtml(household.id)}</h2><p>${escapeHtml(household.pumaName)} · PUMA ${escapeHtml(household.puma)}</p></div><span class="badge outreach-${household.tier}">${outreachTierLabel(household.tier)}</span></div>
    <div class="outreach-fit-box"><strong>Why this audience fits</strong><ul><li>${household.householdSize}-person household aligns with family-sized units</li><li>${formatMoney(household.income)} is within the low–middle campaign band</li><li>Income covers ${household.coveragePercent}% of the modeled Household Living Budget</li></ul></div>
    <div class="outreach-detail-facts"><div><span>Adults / children</span><strong>${household.adults} / ${household.children}</strong></div><div><span>Annual budget gap</span><strong>${formatMoney(household.annualGap)}</strong></div><div><span>Modeled housing cost</span><strong>${formatMoney(household.housingCostMonth)} / month</strong></div><div><span>Campaign status</span><strong>${status.label}</strong></div></div>
    <div class="channel-recommendation"><span class="segment-icon" aria-hidden="true">◎</span><div><p class="eyebrow">SUGGESTED CHANNEL</p><h3>${escapeHtml(household.recommendedChannel)}</h3><p>${escapeHtml(household.channelReason)}</p></div></div>
    <button class="primary-button outreach-plan-button" type="button" data-outreach-action data-outreach-id="${escapeHtml(household.id)}">${status.action}</button>
    <p class="calculation-note">This row cannot be contacted. Add it to the campaign plan only as an anonymous example of the audience pattern.</p>
  `;
}

function renderOutreachWorkspace() {
  renderOutreachMetrics();
  renderOutreachRows();
  renderOutreachAreas();
  renderOutreachDetail();
}

function advanceOutreachPlan(id) {
  const current = getOutreachStatus(id);
  const next = current === "not-planned" ? "campaign-ready" : current === "campaign-ready" ? "partner-assigned" : "not-planned";
  state.outreachStatuses[id] = next;
  saveOutreachStatuses();
  renderOutreachWorkspace();
  showToast(next === "not-planned" ? "Household pattern removed from the campaign plan." : `${outreachPlanStages[next].label} for this anonymous audience example.`);
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
    const mortgageLinked = application.financingPath === "mortgage-matching" && state.buyerProfiles.some((profile) => profile.applicationId === application.id);
    const isSelected = application.id === state.selectedId;
    return `
      <tr data-application-id="${escapeHtml(application.id)}" class="${isSelected ? "selected" : ""}" tabindex="0" aria-selected="${isSelected}">
        <td><div class="applicant-cell"><span class="applicant-avatar">${escapeHtml(initials(application.applicant))}</span><div><strong>${escapeHtml(application.applicant)}</strong><span>${escapeHtml(application.id)} · ${statusLabels[application.status]}</span><span class="table-financing-state ${mortgageLinked ? "linked" : "review"}">${mortgageLinked ? "$ Mortgage linked" : "Financing review"}</span></div></div></td>
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
  const buyerProfile = state.buyerProfiles.find((profile) => profile.applicationId === application.id);
  const mortgageLinked = application.financingPath === "mortgage-matching" && Boolean(buyerProfile);
  const preapprovalLabels = { complete: "Complete", "in-progress": "In progress", "not-started": "Not started" };

  panel.innerHTML = `
    <div class="case-panel-inner">
      <div class="case-head">
        <div class="case-head-top"><div><h2>${escapeHtml(application.applicant)}</h2><p>${escapeHtml(application.id)} · Updated ${formatDate(application.submitted)}</p></div><span class="badge priority-${priority.level}">${priority.level === "high" ? "High priority" : "Standard review"}</span></div>
        <div class="case-badges"><span class="badge ${application.status}">${statusLabels[application.status]}</span>${mortgageLinked ? '<span class="badge mortgage-linked">Mortgage linked</span>' : ""}<span class="human-review-label">Human-reviewed case</span></div>
      </div>

      <div class="case-scroll">
        <section class="next-action-card">
          <p class="eyebrow">NEXT RECOMMENDED ACTION</p>
          <h3>${escapeHtml(nextAction.title)}</h3>
          <p>${escapeHtml(nextAction.detail)}</p>
          <div class="next-action-buttons">
            <button class="secondary-button" type="button" data-panel-action="request-documents">Request Documents</button>
            <button class="secondary-button" type="button" data-panel-action="view-matches">View Housing Matches</button>
            ${mortgageLinked ? '<button class="secondary-button" type="button" data-panel-action="open-mortgage">Open Mortgage Match</button>' : ""}
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

        <section class="case-section financing-section">
          <div class="section-heading-row"><div><h3>Purchase financing pathway</h3><p>Connected to this program application</p></div><span class="badge ${mortgageLinked ? "mortgage-linked" : "financing-review"}">${mortgageLinked ? "Mortgage referral active" : "Financing review"}</span></div>
          ${mortgageLinked ? `
            <p class="financing-summary">This applicant is included in Mortgage Matching using the same household, income, document, and workflow record shown here.</p>
            <div class="financing-facts">
              <div><span>Financing route</span><strong>${buyerProfile.preapproval === "complete" ? "Preapproved; seeking assistance" : "Mortgage and assistance matching"}</strong></div>
              <div><span>AMI</span><strong>${buyerProfile.amiPercent}%</strong></div>
              <div><span>Target purchase price</span><strong>${formatMoney(buyerProfile.targetPrice)}</strong></div>
              <div><span>Preapproval</span><strong>${preapprovalLabels[buyerProfile.preapproval]}</strong></div>
            </div>
            <button class="secondary-button mortgage-link-button" type="button" data-panel-action="open-mortgage">Open linked mortgage record →</button>
          ` : `
            <p class="financing-summary">A mortgage referral is not active for this record. Staff should first confirm the household's ownership goal and a sustainable purchase-financing route; this status is not a denial.</p>
            <div class="financing-facts"><div><span>Current pathway</span><strong>Ownership and financing review</strong></div><div><span>Mortgage pipeline</span><strong>Not enrolled</strong></div></div>
          `}
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
            <div class="fact"><span>Mortgage pathway</span><strong>${mortgageLinked ? "Linked" : "Not active"}</strong></div>
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
  const labels = { applications: "Housing Matching & Applications", mortgage: "Mortgage matching", map: "Site planning map", overview: "Program overview", outreach: "Outreach" };
  document.getElementById("breadcrumb-current").textContent = labels[viewName];
  document.querySelector(".sidebar").classList.remove("open");
  document.querySelector(".mobile-menu").setAttribute("aria-expanded", "false");
  if (viewName === "mortgage") renderMortgageWorkspace();
  if (viewName === "outreach") renderOutreachWorkspace();
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
    financingPath: "financing-review",
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

  document.getElementById("outreach-search").addEventListener("input", (event) => {
    state.outreachSearch = event.target.value;
    renderOutreachWorkspace();
  });
  [
    ["outreach-tier-filter", "outreachTier"],
    ["outreach-size-filter", "outreachSize"],
    ["outreach-area-filter", "outreachArea"],
    ["outreach-channel-filter", "outreachChannel"],
    ["outreach-sort", "outreachSort"],
  ].forEach(([id, stateKey]) => document.getElementById(id).addEventListener("change", (event) => {
    state[stateKey] = event.target.value;
    renderOutreachWorkspace();
  }));
  document.getElementById("outreach-rows").addEventListener("click", (event) => {
    const action = event.target.closest("[data-outreach-action]");
    if (action) {
      advanceOutreachPlan(action.dataset.outreachId);
      return;
    }
    const row = event.target.closest("tr[data-outreach-id]");
    if (!row) return;
    state.selectedOutreachId = row.dataset.outreachId;
    renderOutreachWorkspace();
  });
  document.getElementById("outreach-rows").addEventListener("keydown", (event) => {
    if (event.target.closest("button")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("tr[data-outreach-id]");
    if (!row) return;
    event.preventDefault();
    state.selectedOutreachId = row.dataset.outreachId;
    renderOutreachWorkspace();
  });
  document.getElementById("outreach-areas").addEventListener("click", (event) => {
    const area = event.target.closest("[data-outreach-area]");
    if (!area) return;
    state.outreachArea = area.dataset.outreachArea;
    document.getElementById("outreach-area-filter").value = state.outreachArea;
    renderOutreachWorkspace();
  });
  document.getElementById("outreach-detail").addEventListener("click", (event) => {
    const action = event.target.closest("[data-outreach-action]");
    if (action) advanceOutreachPlan(action.dataset.outreachId);
  });

  document.getElementById("buyer-search").addEventListener("input", (event) => {
    state.buyerSearch = event.target.value;
    renderMortgageWorkspace();
  });
  document.getElementById("buyer-ami-filter").addEventListener("change", (event) => {
    state.buyerAmiFilter = event.target.value;
    renderMortgageWorkspace();
  });
  document.getElementById("buyer-readiness-filter").addEventListener("change", (event) => {
    state.buyerReadinessFilter = event.target.value;
    renderMortgageWorkspace();
  });
  document.getElementById("buyer-list").addEventListener("click", (event) => {
    const buyer = event.target.closest("[data-buyer-id]");
    if (!buyer) return;
    state.selectedBuyerId = buyer.dataset.buyerId;
    renderMortgageWorkspace();
  });
  document.getElementById("mortgage-buyer-detail").addEventListener("change", (event) => {
    if (event.target.id !== "planning-rate") return;
    state.planningRate = clamp(Number(event.target.value) || 6.5, 1, 15);
    renderMortgageWorkspace();
  });
  document.getElementById("mortgage-buyer-detail").addEventListener("click", (event) => {
    if (event.target.closest("[data-return-application]")) {
      state.selectedId = state.selectedBuyerId;
      renderApplications();
      switchView("applications");
      return;
    }
    if (!event.target.closest("[data-mortgage-action]")) return;
    showToast("Recommended mortgage-matching task opened for staff follow-up.");
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
      if (action === "open-mortgage") {
        state.selectedBuyerId = state.selectedId;
        state.buyerSearch = "";
        state.buyerAmiFilter = "all";
        state.buyerReadinessFilter = "all";
        document.getElementById("buyer-search").value = "";
        document.getElementById("buyer-ami-filter").value = "all";
        document.getElementById("buyer-readiness-filter").value = "all";
        switchView("mortgage");
        return;
      }
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
  document.getElementById("outreach-method").addEventListener("click", () => openDialog("outreach-method-dialog"));
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
    const [applicationsResponse, propertiesResponse, buyerProfilesResponse, mortgageProgramsResponse, outreachResponse] = await Promise.all([
      fetch("data/applications.json"),
      fetch("data/properties.json"),
      fetch("data/buyer_profiles.json"),
      fetch("data/mortgage_programs.json"),
      fetch("data/outreach_households.json"),
    ]);
    if (![applicationsResponse, propertiesResponse, buyerProfilesResponse, mortgageProgramsResponse, outreachResponse].every((response) => response.ok)) throw new Error("One or more data files could not be loaded");
    state.properties = await propertiesResponse.json();
    state.buyerProfiles = await buyerProfilesResponse.json();
    state.mortgagePrograms = await mortgageProgramsResponse.json();
    state.outreachData = await outreachResponse.json();
    state.outreachStatuses = loadOutreachStatuses();
    state.applications = loadStoredState(await applicationsResponse.json());
    state.selectedId = state.applications.find((application) => application.id === "HA-260211")?.id || getFilteredApplications()[0]?.id || null;
    state.selectedOutreachId = state.outreachData.households.find((household) => household.tier === "market-first")?.id || null;
    initializeOutreachFilters();
    renderApplications();
    renderMortgageWorkspace();
    renderOutreachWorkspace();
  } catch (error) {
    document.getElementById("queue-summary").textContent = "Application data could not be loaded.";
    document.getElementById("application-rows").innerHTML = `<tr><td colspan="7">Serve this folder over HTTP to load the demonstration data (${escapeHtml(error.message)}).</td></tr>`;
    document.getElementById("case-panel").innerHTML = `<div class="empty-state"><h3>Case data unavailable</h3><p>Check the local server and reload the page.</p></div>`;
  }
}

initialize();
