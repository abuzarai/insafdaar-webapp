// Shared interview-summary + advocate-matching logic (audit #23 dedup).
// Previously duplicated across:
//  - controllers/clientDashboard/startCase/startCase.controller.js
//  - controllers/admin/client-access/start-case/startCase.admin.controller.js
//  - controllers/advocateDashboard/cases/cases.controller.js
function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, max = 60) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

function isPlaceholderCaseText(value) {
  const v = normalizeText(value).toLowerCase();
  if (!v) return true;

  const placeholders = [
    "draft created for interview/voice recording",
    "draft created for interview",
    "draft created for voice recording",
    "draft created",
    "untitled case",
    "case",
  ];

  return placeholders.includes(v);
}

function pickShortCaseTitle({ title, description, issueSummary, caseTitleEn, caseTitleUr, preferredLanguage }) {
  const lang = normalizeText(preferredLanguage).toLowerCase();
  const aiTitleUr = normalizeText(caseTitleUr);
  const aiTitleEn = normalizeText(caseTitleEn);

  if (lang === "urdu" && aiTitleUr && !isPlaceholderCaseText(aiTitleUr)) {
    return truncateText(aiTitleUr, 60);
  }

  if (aiTitleEn && !isPlaceholderCaseText(aiTitleEn)) {
    return truncateText(aiTitleEn, 60);
  }

  const cleanTitle = normalizeText(title);
  if (cleanTitle && !isPlaceholderCaseText(cleanTitle)) return truncateText(cleanTitle, 60);

  const cleanDescription = normalizeText(description);
  if (cleanDescription && !isPlaceholderCaseText(cleanDescription)) {
    const firstSentence = cleanDescription.split(/[.!?]\s+/)[0] || cleanDescription;
    if (!isPlaceholderCaseText(firstSentence)) {
      return truncateText(firstSentence, 60);
    }
  }

  const cleanIssueSummary = normalizeText(issueSummary);
  if (cleanIssueSummary) return truncateText(cleanIssueSummary, 60);

  return "Untitled case";
}

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => toStringOrNull(v))
      .filter(Boolean)
      .slice(0, 8);
  }

  const raw = toStringOrNull(value);
  if (!raw) return [];

  return raw
    .split(/\n|\||;|,/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeInterviewSummary(analysis) {
  const a = toObject(analysis);

  return {
    primaryLanguage: toStringOrNull(a.primary_language),
    legalDomain: toStringOrNull(a.legal_domain),
    issueSummary: toStringOrNull(a.issue_summary),
    caseTitleEn: toStringOrNull(a.case_title_en),
    caseTitleUr: toStringOrNull(a.case_title_ur),
    urgency: toStringOrNull(a.urgency),
    urgencyReasoning: toStringOrNull(a.urgency_reasoning),
    adrSuitable: typeof a.adr_suitable === "boolean" ? a.adr_suitable : null,
    adrReasoning: toStringOrNull(a.adr_reasoning),
    confidenceScore: toNumberOrNull(a.confidence_score),
    keyEntities: {
      parties: toStringList(a?.key_entities?.parties),
      locations: toStringList(a?.key_entities?.locations),
      dates: toStringList(a?.key_entities?.dates),
      amounts: toStringList(a?.key_entities?.amounts),
    },
  };
}

function buildCaseLabel(caseId, fields = {}) {
  const caseTitleShort = pickShortCaseTitle(fields);
  return {
    case_title_short: caseTitleShort,
    case_display_label: `Case #${Number(caseId)} - ${caseTitleShort}`,
  };
}

function includesLoose(haystack, needle) {
  if (!needle) return false;
  const n = String(needle).trim().toLowerCase();
  if (!n) return false;
  return haystack.some((h) => h.includes(n) || n.includes(h));
}

function scoreCandidate(caseData, advocate) {
  const legalDomain = String(caseData.legalDomain || "").trim().toLowerCase();
  const caseLanguage = String(caseData.language || "").trim().toLowerCase();
  const clientCity = String(caseData.clientCity || "").trim().toLowerCase();

  const practiceAreas = normalizeArray(advocate.practice_areas);
  const advocateLanguages = normalizeArray(advocate.languages);
  const advocateCity = String(advocate.city || "").trim().toLowerCase();

  let domainFit = 0;
  let languageFit = 0;
  let cityFit = 0;
  let experienceBonus = 0;
  let availabilityBonus = 0;
  let workloadPenalty = 0;

  if (legalDomain && includesLoose(practiceAreas, legalDomain)) {
    domainFit = 40;
  } else if (practiceAreas.length > 0 && legalDomain) {
    domainFit = 15;
  }

  if (!caseLanguage) {
    languageFit = 5;
  } else if (includesLoose(advocateLanguages, caseLanguage)) {
    languageFit = 20;
  }

  if (clientCity && advocateCity && clientCity === advocateCity) {
    cityFit = 10;
  } else if (!clientCity || !advocateCity) {
    cityFit = 4;
  }

  const expYears = Number(advocate.experience_years) || 0;
  experienceBonus = clamp((expYears / 15) * 15, 0, 15);

  const maxBookings = Number(advocate.max_bookings_per_day) || 0;
  availabilityBonus = maxBookings >= 6 ? 10 : maxBookings >= 3 ? 6 : 3;

  const activeLoad = Number(advocate.active_case_count) || 0;
  if (activeLoad >= 12) workloadPenalty = 10;
  else if (activeLoad >= 8) workloadPenalty = 7;
  else if (activeLoad >= 5) workloadPenalty = 4;

  const total = clamp(
    domainFit + languageFit + cityFit + experienceBonus + availabilityBonus - workloadPenalty,
    0,
    100
  );

  const reasons = [];
  reasons.push(domainFit >= 35 ? "Strong legal domain fit" : "Partial legal domain fit");
  reasons.push(languageFit >= 20 ? "Language compatible with client" : "Language fit is limited");
  reasons.push(workloadPenalty >= 7 ? "High active workload" : "Current workload manageable");
  reasons.push(experienceBonus >= 10 ? "Experienced profile" : "Moderate experience profile");

  return {
    totalScore: Number(total.toFixed(2)),
    scoreBreakdown: {
      domainFit: Number(domainFit.toFixed(2)),
      languageFit: Number(languageFit.toFixed(2)),
      cityFit: Number(cityFit.toFixed(2)),
      experienceBonus: Number(experienceBonus.toFixed(2)),
      availabilityBonus: Number(availabilityBonus.toFixed(2)),
      workloadPenalty: Number(workloadPenalty.toFixed(2)),
    },
    reasons,
  };
}

async function getLatestInterviewResult(db, caseId) {
  const r = await db.query(
    `
      SELECT
        id,
        mode,
        provider,
        status,
        language,
        transcript,
        analysis,
        audio_url,
        audio_duration,
        completion_source,
        result_hash,
        webhook_received_at,
        fallback_received_at,
        completed_at,
        updated_at,
        created_at
      FROM public.case_intake_sessions
      WHERE case_id = $1
      ORDER BY completed_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC, id DESC
      LIMIT 1
    `,
    [Number(caseId)]
  );

  if (!r.rows[0]) return null;

  const row = r.rows[0];
  return {
    sessionId: Number(row.id),
    meta: {
      mode: row.mode || null,
      provider: row.provider || null,
      status: row.status || null,
      language: row.language || null,
      completedAt: row.completed_at || null,
      updatedAt: row.updated_at || null,
      audioUrl: row.audio_url || null,
      audioDuration: row.audio_duration || null,
      completionSource: row.completion_source || null,
      resultHash: row.result_hash || null,
      webhookReceivedAt: row.webhook_received_at || null,
      fallbackReceivedAt: row.fallback_received_at || null,
    },
    summary: normalizeInterviewSummary(row.analysis),
    transcript: row.transcript || null,
    analysis: row.analysis || null,
  };
}

export { buildCaseLabel, getLatestInterviewResult, scoreCandidate };
