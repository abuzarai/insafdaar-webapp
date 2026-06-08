// controllers/clientDashboard/startCase/startCase.controller.js
import pool from "../../../db.js";
import { CASE_STATUS, transitionCaseStatus } from "../../../utils/caseLifecycle.js";
import { enqueueDocumentExtractionJobs } from "../../../services/documentExtraction.service.js";

let matchingTablesReady = false;
let preferenceColumnsReady = false;

async function ensureMatchingTables() {
  if (matchingTablesReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.case_matching_runs (
      id BIGSERIAL PRIMARY KEY,
      case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
      triggered_by INTEGER REFERENCES public.users(id),
      shortlist_size INTEGER NOT NULL DEFAULT 5,
      input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.case_match_candidates (
      id BIGSERIAL PRIMARY KEY,
      run_id BIGINT NOT NULL REFERENCES public.case_matching_runs(id) ON DELETE CASCADE,
      case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
      advocate_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      rank_position INTEGER NOT NULL,
      total_score NUMERIC(6,2) NOT NULL,
      score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
      reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (run_id, advocate_id),
      UNIQUE (run_id, rank_position)
    )
  `);

  matchingTablesReady = true;
}

async function ensurePreferenceColumns() {
  if (preferenceColumnsReady) return;

  await pool.query(`
    ALTER TABLE public.client_cases
      ADD COLUMN IF NOT EXISTS preferred_advocate_id INTEGER REFERENCES public.users(id),
      ADD COLUMN IF NOT EXISTS preferred_advocate_selected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS preferred_match_run_id BIGINT REFERENCES public.case_matching_runs(id)
  `);

  preferenceColumnsReady = true;
}

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

function buildCaseLabel(caseId, fields = {}) {
  const caseTitleShort = pickShortCaseTitle(fields);
  return {
    case_title_short: caseTitleShort,
    case_display_label: `Case #${Number(caseId)} - ${caseTitleShort}`,
  };
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

async function getLatestInterviewResult(dbClient, caseId) {
  const r = await dbClient.query(
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

async function loadCaseWithOwnership(client, caseId, userId) {
  const r = await client.query(
    `
      SELECT
        c.id,
        c.user_id,
        c.title,
        c.description,
        c.language,
        c.status,
        c.interview_completed,
        c.legal_domain,
        c.preferred_advocate_id,
        c.preferred_advocate_selected_at,
        c.preferred_match_run_id,
        cp.city AS client_city
      FROM public.client_cases c
      LEFT JOIN public.client_profiles cp ON cp.user_id = c.user_id
      WHERE c.id = $1 AND c.user_id = $2
      LIMIT 1
      FOR UPDATE OF c
    `,
    [Number(caseId), Number(userId)]
  );
  return r.rows[0] || null;
}

async function getLatestMatchingRun(client, caseId) {
  const runR = await client.query(
    `
      SELECT id, case_id, shortlist_size, input_snapshot, created_at
      FROM public.case_matching_runs
      WHERE case_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [Number(caseId)]
  );
  return runR.rows[0] || null;
}

async function listCandidatesByRun(client, runId) {
  const r = await client.query(
    `
      SELECT
        c.id,
        c.rank_position,
        c.total_score,
        c.score_breakdown,
        c.reasons,
        c.advocate_id,
        u.name AS advocate_name,
        u.email AS advocate_email,
        ap.city,
        ap.languages,
        ap.practice_areas,
        ap.experience_years
      FROM public.case_match_candidates c
      JOIN public.users u ON u.id = c.advocate_id
      LEFT JOIN public.advocate_profiles ap ON ap.user_id = c.advocate_id
      WHERE c.run_id = $1
      ORDER BY c.rank_position ASC
    `,
    [Number(runId)]
  );
  return r.rows;
}

async function createMatchingRun(client, options) {
  const { caseRow, triggeredBy, shortlistSize = 5 } = options;

  const intakeR = await client.query(
    `
      SELECT analysis
      FROM public.case_intake_sessions
      WHERE case_id = $1
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
    [Number(caseRow.id)]
  );

  const intakeAnalysis = intakeR.rows[0]?.analysis || null;
  const inferredLegalDomain =
    String(caseRow.legal_domain || "").trim() ||
    String(intakeAnalysis?.legal_domain || intakeAnalysis?.domain || "").trim() ||
    null;

  const advocatesR = await client.query(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        ap.city,
        ap.languages,
        ap.practice_areas,
        ap.experience_years,
        aas.max_bookings_per_day,
        COALESCE(load.active_case_count, 0) AS active_case_count
      FROM public.users u
      LEFT JOIN public.advocate_profiles ap ON ap.user_id = u.id
      LEFT JOIN public.advocate_availability_settings aas ON aas.user_id = u.id
      LEFT JOIN (
        SELECT assigned_advocate_id, COUNT(*)::int AS active_case_count
        FROM public.client_cases
        WHERE assigned_advocate_id IS NOT NULL
          AND status NOT IN ('CASE_ACTIVE_CLOSED', 'CLOSED', 'DISMISSED', 'ARCHIVED')
        GROUP BY assigned_advocate_id
      ) load ON load.assigned_advocate_id = u.id
      WHERE LOWER(u.role) = 'advocate'
        AND COALESCE(ap.is_verified, true) = true
    `
  );

  const caseData = {
    legalDomain: inferredLegalDomain,
    language: caseRow.language,
    clientCity: caseRow.client_city,
  };

  const ranked = advocatesR.rows
    .map((a) => {
      const scored = scoreCandidate(caseData, a);
      return {
        advocateId: Number(a.id),
        totalScore: scored.totalScore,
        scoreBreakdown: scored.scoreBreakdown,
        reasons: scored.reasons,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, shortlistSize);

  const run = await client.query(
    `
      INSERT INTO public.case_matching_runs
        (case_id, triggered_by, shortlist_size, input_snapshot)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id, case_id, shortlist_size, input_snapshot, created_at
    `,
    [
      Number(caseRow.id),
      triggeredBy ? Number(triggeredBy) : null,
      Number(shortlistSize),
      JSON.stringify({
        caseTitle: caseRow.title,
        legalDomain: inferredLegalDomain,
        language: caseRow.language || null,
        clientCity: caseRow.client_city || null,
        analysis: intakeAnalysis || null,
      }),
    ]
  );

  for (let i = 0; i < ranked.length; i += 1) {
    const item = ranked[i];
    await client.query(
      `
        INSERT INTO public.case_match_candidates
          (run_id, case_id, advocate_id, rank_position, total_score, score_breakdown, reasons)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::text[])
      `,
      [
        Number(run.rows[0].id),
        Number(caseRow.id),
        Number(item.advocateId),
        i + 1,
        item.totalScore,
        JSON.stringify(item.scoreBreakdown),
        item.reasons,
      ]
    );
  }

  return run.rows[0];
}

/**
 * Helper: load latest active case for user
 */
async function getLatestActiveCase(userId) {
  const r = await pool.query(
    `
    SELECT *
    FROM public.client_cases
    WHERE user_id = $1
      AND status IN ('DRAFT', 'INTAKE_STARTED', 'MATCHING_REVIEW', 'ADVOCATE_ASSIGNED')
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [userId]
  );
  return r.rows[0] || null;
}

/**
 * ✅ GET /api/client/dashboard/start-case/active
 * Return latest active case (used for refresh restore)
 */
export async function getActiveStartCase(req, res) {
  try {
    const userId = req.user.id;
    const c = await getLatestActiveCase(userId);
    if (!c) return res.json({ case: null });

    const labels = buildCaseLabel(c.id, {
      title: c.title,
      description: c.description,
      issueSummary: null,
      preferredLanguage: c.language,
    });

    return res.json({ case: { ...c, ...labels } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * ✅ POST /api/client/dashboard/start-case/draft
 * body: { caseId?, title?, description, language? }
 *
 * Behavior:
 * - If caseId provided → update that specific case
 * - Else → update latest DRAFT for this user OR create new
 */
export async function createDraftCase(req, res) {
  try {
    const userId = req.user.id;
    const {
      caseId = null,
      title = null,
      description,
      language = "English",
    } = req.body || {};

    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: "description is required" });
    }

    // ✅ 1) If frontend sends caseId, update that exact case (recommended)
    if (caseId) {
      const own = await pool.query(
        `SELECT id, status FROM public.client_cases WHERE id=$1 AND user_id=$2`,
        [Number(caseId), userId]
      );
      if (own.rows.length === 0) return res.status(404).json({ error: "Case not found" });

      const upd = await pool.query(
        `
        UPDATE public.client_cases
        SET
          title = COALESCE($2, title),
          description = $3,
          language = COALESCE($4, language),
          source = 'text',
          updated_at = NOW()
        WHERE id=$1 AND user_id=$5
        RETURNING *
        `,
        [Number(caseId), title, String(description).trim(), String(language), userId]
      );

      return res.json({ message: "Draft updated", case: upd.rows[0] });
    }

    // ✅ 2) If no caseId: update latest DRAFT if exists
    const existingDraft = await pool.query(
      `
      SELECT id
      FROM public.client_cases
      WHERE user_id=$1 AND status='DRAFT'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
      `,
      [userId]
    );

    if (existingDraft.rows.length > 0) {
      const draftId = existingDraft.rows[0].id;

      const upd = await pool.query(
        `
        UPDATE public.client_cases
        SET
          title = COALESCE($2, title),
          description = $3,
          language = COALESCE($4, language),
          source = 'text',
          updated_at = NOW()
        WHERE id=$1 AND user_id=$5
        RETURNING *
        `,
        [Number(draftId), title, String(description).trim(), String(language), userId]
      );

      return res.json({ message: "Draft updated", case: upd.rows[0] });
    }

    // ✅ 3) Else create new draft
    const ins = await pool.query(
      `
      INSERT INTO public.client_cases
        (user_id, title, description, source, language, status, updated_at)
      VALUES
        ($1,$2,$3,'text',$4,'DRAFT',NOW())
      RETURNING *
      `,
      [userId, title, String(description).trim(), String(language)]
    );

    return res.json({ message: "Draft created", case: ins.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/client/dashboard/start-case/ai/start
 */
export async function startAiInterviewSession(req, res) {
  try {
    const userId = req.user.id;
    const { caseId, provider = "gcp", providerSessionId = null } = req.body || {};

    if (!caseId) return res.status(400).json({ error: "caseId is required" });

    const c = await pool.query(
      `SELECT id FROM public.client_cases WHERE id=$1 AND user_id=$2`,
      [Number(caseId), userId]
    );
    if (c.rows.length === 0) return res.status(404).json({ error: "Case not found" });

    const s = await pool.query(
      `
      INSERT INTO public.case_intake_sessions
        (case_id, mode, provider, provider_session_id, status)
      VALUES
        ($1,'voice_ai',$2,$3,'STARTED')
      RETURNING *
      `,
      [Number(caseId), provider, providerSessionId]
    );

    await pool.query(
      `
      UPDATE public.client_cases
      SET status='INTAKE_STARTED', source='ai', updated_at=NOW()
      WHERE id=$1
      `,
      [Number(caseId)]
    );

    return res.json({ message: "AI interview session started", intakeSession: s.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/client/dashboard/start-case/voice/upload (multipart)
 */
export async function uploadOtherLanguageVoice(req, res) {
  try {
    const userId = req.user.id;
    const { caseId, language = "Other", notes = "" } = req.body || {};

    if (!caseId) return res.status(400).json({ error: "caseId is required" });
    if (!req.file) return res.status(400).json({ error: "audio file is required" });

    const c = await pool.query(
      `SELECT id FROM public.client_cases WHERE id=$1 AND user_id=$2`,
      [Number(caseId), userId]
    );
    if (c.rows.length === 0) return res.status(404).json({ error: "Case not found" });

    const audioUrl = `/uploads/case-audio/${req.file.filename}`;

    const v = await pool.query(
      `
      INSERT INTO public.case_voice_notes (case_id, language, audio_url, notes)
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [Number(caseId), String(language), audioUrl, String(notes)]
    );

    await pool.query(
      `
      UPDATE public.client_cases
      SET source='voice', language=$2, updated_at=NOW()
      WHERE id=$1
      `,
      [Number(caseId), String(language)]
    );

    return res.json({ message: "Voice uploaded", voice: v.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/client/dashboard/start-case/documents/upload (multipart)
 */
export async function uploadCaseDocument(req, res) {
  try {
    const userId = req.user.id;
    const { caseId, docType = "OTHER", language = null } = req.body || {};
    const noteRaw = String(req.body?.note || "").trim();
    const note = noteRaw ? noteRaw.slice(0, 1000) : null;

    if (!caseId) return res.status(400).json({ error: "caseId is required" });
    if (!req.file) return res.status(400).json({ error: "file is required" });

    const c = await pool.query(
      `SELECT id FROM public.client_cases WHERE id=$1 AND user_id=$2`,
      [Number(caseId), userId]
    );
    if (c.rows.length === 0) return res.status(404).json({ error: "Case not found" });

    const fileUrl = `/uploads/case-documents/${req.file.filename}`;

    const d = await pool.query(
      `
      INSERT INTO public.case_documents (case_id, doc_type, file_url, status, note)
      VALUES ($1,$2,$3,'UPLOADED',$4)
      RETURNING *
      `,
      [Number(caseId), String(docType), fileUrl, note]
    );

    await enqueueDocumentExtractionJobs([
      {
        source_table: "case_documents",
        document_id: d.rows[0].id,
        file_url: d.rows[0].file_url,
        case_id: Number(caseId),
        user_id: null,
      },
    ]).catch((e) => {
      console.error("enqueueDocumentExtractionJobs(case_documents):", e?.message || e);
    });

    if (language && String(language).trim()) {
      await pool.query(
        `UPDATE public.client_cases SET language=$2, updated_at=NOW() WHERE id=$1 AND user_id=$3`,
        [Number(caseId), String(language), userId]
      );
    }

    return res.json({ message: "Document uploaded", document: d.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function listCaseDocuments(req, res) {
  try {
    const userId = req.user.id;
    const caseId = Number(req.query.caseId);

    if (!caseId) return res.status(400).json({ error: "caseId is required" });

    const c = await pool.query(
      `SELECT id FROM public.client_cases WHERE id=$1 AND user_id=$2`,
      [caseId, userId]
    );
    if (c.rows.length === 0) return res.status(404).json({ error: "Case not found" });

    const r = await pool.query(
      `
      SELECT id, doc_type, file_url, status, note, created_at
      FROM public.case_documents
      WHERE case_id=$1
      ORDER BY created_at DESC
      `,
      [caseId]
    );

    return res.json({ documents: r.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function listCaseVoiceNotes(req, res) {
  try {
    const userId = req.user.id;
    const caseId = Number(req.query.caseId);

    if (!caseId) return res.status(400).json({ error: "caseId is required" });

    const c = await pool.query(
      `SELECT id FROM public.client_cases WHERE id=$1 AND user_id=$2`,
      [caseId, userId]
    );
    if (c.rows.length === 0) return res.status(404).json({ error: "Case not found" });

    const r = await pool.query(
      `
      SELECT id, language, audio_url, notes, created_at
      FROM public.case_voice_notes
      WHERE case_id=$1
      ORDER BY created_at DESC
      `,
      [caseId]
    );

    return res.json({ voiceNotes: r.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/client/dashboard/start-case/interview/complete
 * body: { caseId, legalDomain? }
 * For UI flow where webhook processing might be delayed, this marks case ready for matching.
 */
export async function markInterviewCompleteForCase(req, res) {
  try {
    await ensurePreferenceColumns();

    const userId = Number(req.user.id);
    const caseId = Number(req.body?.caseId);
    const legalDomain = req.body?.legalDomain ? String(req.body.legalDomain).trim() : null;

    if (!caseId) return res.status(400).json({ error: "caseId is required" });

    const r = await pool.query(
      `
        UPDATE public.client_cases
        SET legal_domain = COALESCE($3, legal_domain),
            interview_completed = true,
            status = CASE
              WHEN status IN ('DRAFT', 'INTAKE_STARTED') THEN 'MATCHING_REVIEW'
              ELSE status
            END,
            updated_at = NOW()
        WHERE id = $1
          AND user_id = $2
        RETURNING id, status, interview_completed, legal_domain
      `,
      [caseId, userId, legalDomain]
    );

    if (!r.rows[0]) return res.status(404).json({ error: "Case not found" });

    return res.json({
      message: "Interview marked complete. Matching is now available.",
      case: r.rows[0],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to mark interview complete" });
  }
}

/**
 * GET /api/client/dashboard/start-case/matching?caseId=123
 * Auto-creates a shortlist if not yet created.
 */
export async function getCaseMatchingForClient(req, res) {
  const client = await pool.connect();
  try {
    await ensureMatchingTables();
    await ensurePreferenceColumns();

    const userId = Number(req.user.id);
    const caseId = Number(req.query.caseId);
    if (!caseId) return res.status(400).json({ error: "caseId is required" });

    await client.query("BEGIN");

    const caseRow = await loadCaseWithOwnership(client, caseId, userId);
    if (!caseRow) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Case not found" });
    }

    if (!caseRow.interview_completed) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Interview not completed yet. Please finish the interview first.",
      });
    }

    let run = await getLatestMatchingRun(client, caseId);
    if (!run) {
      run = await createMatchingRun(client, {
        caseRow,
        triggeredBy: userId,
        shortlistSize: 5,
      });

      await transitionCaseStatus(client, {
        caseId,
        toStatus: CASE_STATUS.MATCHING_REVIEW,
        actorUserId: userId,
        actorRole: req.user?.role || "CLIENT",
        reason: "Client opened matching shortlist",
        metadata: { runId: run.id, source: "client" },
      });
    }

    const candidates = await listCandidatesByRun(client, run.id);
    const interview = await getLatestInterviewResult(client, caseId);

    if (candidates.length === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error:
          "No advocate is currently available for matching. Please ask admin to verify advocate profiles (practice areas/languages/verification).",
      });
    }
    await client.query("COMMIT");

    const caseLabels = buildCaseLabel(caseId, {
      title: caseRow.title,
      description: caseRow.description,
      issueSummary: run?.input_snapshot?.analysis?.issue_summary || null,
      caseTitleEn: run?.input_snapshot?.analysis?.case_title_en || null,
      caseTitleUr: run?.input_snapshot?.analysis?.case_title_ur || null,
      preferredLanguage: caseRow.language,
    });

    return res.json({
      caseId,
      run,
      ...caseLabels,
      selectedAdvocateId: caseRow.preferred_advocate_id || null,
      selectedAt: caseRow.preferred_advocate_selected_at || null,
      interview,
      candidates,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ error: err.message || "Failed to load matching" });
  } finally {
    client.release();
  }
}

/**
 * POST /api/client/dashboard/start-case/matching/select
 * body: { caseId, advocateId }
 */
export async function selectPreferredAdvocate(req, res) {
  const client = await pool.connect();
  try {
    await ensureMatchingTables();
    await ensurePreferenceColumns();

    const userId = Number(req.user.id);
    const caseId = Number(req.body?.caseId);
    const advocateId = Number(req.body?.advocateId);

    if (!caseId) return res.status(400).json({ error: "caseId is required" });
    if (!advocateId) return res.status(400).json({ error: "advocateId is required" });

    await client.query("BEGIN");

    const caseRow = await loadCaseWithOwnership(client, caseId, userId);
    if (!caseRow) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Case not found" });
    }

    const run = await getLatestMatchingRun(client, caseId);
    if (!run) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Matching shortlist not found. Run matching first." });
    }

    const candidateR = await client.query(
      `
        SELECT 1
        FROM public.case_match_candidates
        WHERE run_id = $1 AND case_id = $2 AND advocate_id = $3
        LIMIT 1
      `,
      [Number(run.id), Number(caseId), Number(advocateId)]
    );

    if (!candidateR.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Selected advocate is not in current shortlist" });
    }

    await client.query(
      `
        UPDATE public.client_cases
        SET preferred_advocate_id = $2,
            preferred_advocate_selected_at = NOW(),
            preferred_match_run_id = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
      [Number(caseId), Number(advocateId), Number(run.id)]
    );

    await transitionCaseStatus(client, {
      caseId,
      toStatus: CASE_STATUS.MATCHING_REVIEW,
      actorUserId: userId,
      actorRole: req.user?.role || "CLIENT",
      reason: "Client selected preferred advocate",
      metadata: { advocateId: Number(advocateId), runId: Number(run.id) },
    });

    await client.query("COMMIT");

    return res.json({
      message: "Preferred advocate selected. Waiting for admin approval.",
      caseId,
      preferredAdvocateId: advocateId,
      runId: run.id,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ error: err.message || "Failed to select advocate" });
  } finally {
    client.release();
  }
}
