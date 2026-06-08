import pool from "../../../../db.js";
import { sendNotificationEmail } from "../../../../utils/mailer.js";
import { CASE_STATUS, transitionCaseStatus } from "../../../../utils/caseLifecycle.js";

let matchingTablesReady = false;

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

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
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

function includesLoose(haystack, needle) {
  if (!needle) return false;
  const n = String(needle).trim().toLowerCase();
  if (!n) return false;
  return haystack.some((h) => h.includes(n) || n.includes(h));
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

/** helper */
async function getLatestActiveCaseByUserId(userId) {
  const r = await pool.query(
    `
    SELECT *
    FROM public.client_cases
    WHERE user_id = $1
      AND status IN ('DRAFT', 'INTAKE_STARTED', 'MATCHING_REVIEW')
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [Number(userId)]
  );
  return r.rows[0] || null;
}

/** helper: best-effort DB notify advocate (won't break if table missing) */
async function notifyAdvocateInDb({ advocateId, title, message, type = "CASE", priority = "HIGH" }) {
  try {
    await pool.query(
      `
      INSERT INTO public.advocate_notifications
        (advocate_id, title, description, type, priority, is_read, created_at)
      VALUES ($1,$2,$3,$4,$5,false,NOW())
      `,
      [Number(advocateId), title, message || "", type, priority]
    );
  } catch {
    // table might not exist => ignore
  }
}

/**
 * GET /api/admin/client-access/start-case/active?userId=123
 */
export async function adminGetClientActiveStartCase(req, res) {
  try {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const c = await getLatestActiveCaseByUserId(userId);
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
 * GET /api/admin/client-access/start-case/documents?caseId=123
 */
export async function adminGetCaseDocuments(req, res) {
  try {
    const caseId = Number(req.query.caseId);
    if (!caseId) return res.status(400).json({ error: "caseId is required" });

    const r = await pool.query(
      `
      SELECT id, doc_type, file_url, status, created_at
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

/**
 * GET /api/admin/client-access/start-case/voice?caseId=123
 */
export async function adminGetCaseVoiceNotes(req, res) {
  try {
    const caseId = Number(req.query.caseId);
    if (!caseId) return res.status(400).json({ error: "caseId is required" });

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
 * GET /api/admin/client-access/start-case/assignment-queue
 * Returns cases waiting for matching/assignment in one list.
 */
export async function adminListAssignmentQueue(req, res) {
  try {
    await ensureMatchingTables();

    const r = await pool.query(
      `
      SELECT
        c.id AS case_id,
        c.user_id,
        c.title,
        c.description,
        c.status,
        c.language,
        c.legal_domain,
        c.interview_completed,
        c.preferred_advocate_id,
        c.preferred_advocate_selected_at,
        c.updated_at,
        cu.name AS client_name,
        cu.email AS client_email,
        pa.name AS preferred_advocate_name,
        pa.email AS preferred_advocate_email,
        ((li.transcript IS NOT NULL) OR (li.analysis IS NOT NULL)) AS has_interview_results,
        li.completed_at AS interview_completed_at,
        COALESCE(
          NULLIF(c.legal_domain, ''),
          NULLIF(li.analysis->>'legal_domain', ''),
          NULLIF(li.analysis->>'domain', '')
        ) AS interview_legal_domain,
        COALESCE(
          NULLIF(li.analysis->>'issue_summary', ''),
          NULLIF(li.analysis->>'summary', ''),
          NULLIF(li.analysis->>'case_summary', '')
        ) AS interview_primary_issue,
        mr.id AS latest_match_run_id,
        mr.created_at AS latest_match_run_at,
        COALESCE(mc.candidate_count, 0) AS shortlist_count
      FROM public.client_cases c
      JOIN public.users cu ON cu.id = c.user_id
      LEFT JOIN public.users pa ON pa.id = c.preferred_advocate_id
      LEFT JOIN LATERAL (
        SELECT i.id, i.transcript, i.analysis, i.completed_at
        FROM public.case_intake_sessions i
        WHERE i.case_id = c.id
        ORDER BY i.completed_at DESC NULLS LAST, i.updated_at DESC NULLS LAST, i.created_at DESC, i.id DESC
        LIMIT 1
      ) li ON TRUE
      LEFT JOIN LATERAL (
        SELECT m.id, m.created_at
        FROM public.case_matching_runs m
        WHERE m.case_id = c.id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
      ) mr ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS candidate_count
        FROM public.case_match_candidates cm
        WHERE cm.run_id = mr.id
      ) mc ON TRUE
      WHERE c.status IN ('MATCHING_REVIEW', 'ADVOCATE_ASSIGNED', 'INTAKE_STARTED')
      ORDER BY c.updated_at DESC, c.id DESC
      `
    );

    const queue = r.rows.map((item) => {
      const labels = buildCaseLabel(item.case_id, {
        title: item.title,
        description: item.description,
        issueSummary: item.interview_primary_issue,
        preferredLanguage: item.interview_language,
      });
      return {
        ...item,
        ...labels,
      };
    });

    return res.json({ queue });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/admin/client-access/start-case/matching/run
 * body: { caseId, shortlistSize? }
 */
export async function adminRunCaseMatching(req, res) {
  const client = await pool.connect();
  try {
    await ensureMatchingTables();

    const caseId = Number(req.body?.caseId);
    const shortlistSizeRaw = Number(req.body?.shortlistSize || 5);
    const shortlistSize = Math.min(10, Math.max(1, Number.isFinite(shortlistSizeRaw) ? shortlistSizeRaw : 5));

    if (!caseId) return res.status(400).json({ error: "caseId is required" });

    await client.query("BEGIN");

    const caseR = await client.query(
      `
      SELECT
        c.id,
        c.user_id,
        c.title,
        c.description,
        c.language,
        c.legal_domain,
        c.preferred_advocate_id,
        cp.city AS client_city
      FROM public.client_cases c
      LEFT JOIN public.client_profiles cp ON cp.user_id = c.user_id
      WHERE c.id = $1
      FOR UPDATE OF c
      `,
      [caseId]
    );

    if (caseR.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Case not found" });
    }

    const caseRow = caseR.rows[0];

    const intakeR = await client.query(
      `
      SELECT analysis
      FROM public.case_intake_sessions
      WHERE case_id = $1
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
      `,
      [caseId]
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

    const preferredAdvocateId = Number(caseRow.preferred_advocate_id || 0) || null;

    const ranked = advocatesR.rows
      .map((a) => {
        const scored = scoreCandidate(caseData, a);
        let boostedScore = scored.totalScore;
        const reasons = [...scored.reasons];

        if (preferredAdvocateId && Number(a.id) === preferredAdvocateId) {
          boostedScore = Math.min(100, boostedScore + 5);
          reasons.unshift("Client preferred selection");
        }

        return {
          advocateId: Number(a.id),
          advocateName: a.name,
          advocateEmail: a.email,
          totalScore: Number(boostedScore.toFixed(2)),
          scoreBreakdown: scored.scoreBreakdown,
          reasons,
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, shortlistSize);

    const run = await client.query(
      `
      INSERT INTO public.case_matching_runs
        (case_id, triggered_by, shortlist_size, input_snapshot)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id, case_id, shortlist_size, created_at
      `,
      [
        caseId,
        req.user?.id || null,
        shortlistSize,
        JSON.stringify({
          caseTitle: caseRow.title,
          legalDomain: inferredLegalDomain,
          language: caseRow.language || null,
          clientCity: caseRow.client_city || null,
          analysis: intakeAnalysis || null,
        }),
      ]
    );

    const runId = run.rows[0].id;

    for (let i = 0; i < ranked.length; i += 1) {
      const item = ranked[i];
      await client.query(
        `
        INSERT INTO public.case_match_candidates
          (run_id, case_id, advocate_id, rank_position, total_score, score_breakdown, reasons)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::text[])
        `,
        [
          runId,
          caseId,
          item.advocateId,
          i + 1,
          item.totalScore,
          JSON.stringify(item.scoreBreakdown),
          item.reasons,
        ]
      );
    }

    await transitionCaseStatus(client, {
      caseId,
      toStatus: CASE_STATUS.MATCHING_REVIEW,
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || "ADMIN",
      reason: "Matching run completed",
      metadata: { runId, shortlistSize },
    });

    await client.query("COMMIT");

    return res.json({
      message: "Matching shortlist generated",
      run: run.rows[0],
      candidates: ranked.map((x, idx) => ({ ...x, rank: idx + 1 })),
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

/**
 * GET /api/admin/client-access/start-case/matching/candidates?caseId=123
 */
export async function adminListCaseMatchCandidates(req, res) {
  try {
    await ensureMatchingTables();

    const caseId = Number(req.query.caseId);
    if (!caseId) return res.status(400).json({ error: "caseId is required" });

    const caseMetaR = await pool.query(
      `
      SELECT id, title, description
      FROM public.client_cases
      WHERE id = $1
      LIMIT 1
      `,
      [caseId]
    );

    if (!caseMetaR.rows[0]) {
      return res.status(404).json({ error: "Case not found" });
    }

    const caseMeta = caseMetaR.rows[0];

    const runR = await pool.query(
      `
      SELECT id, case_id, shortlist_size, input_snapshot, created_at
      FROM public.case_matching_runs
      WHERE case_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [caseId]
    );

    if (runR.rows.length === 0) {
      const labels = buildCaseLabel(caseId, {
        title: caseMeta.title,
        description: caseMeta.description,
        issueSummary: null,
        caseTitleEn: null,
        caseTitleUr: null,
        preferredLanguage: null,
      });
      return res.json({ run: null, candidates: [], caseMeta: { case_id: caseId, ...labels } });
    }

    const run = runR.rows[0];

    const candidatesR = await pool.query(
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
      [run.id]
    );

    const interview = await getLatestInterviewResult(pool, caseId);
    const labels = buildCaseLabel(caseId, {
      title: caseMeta.title,
      description: caseMeta.description,
      issueSummary: interview?.summary?.issueSummary || null,
      caseTitleEn: interview?.summary?.caseTitleEn || null,
      caseTitleUr: interview?.summary?.caseTitleUr || null,
      preferredLanguage: interview?.summary?.primaryLanguage || null,
    });

    return res.json({
      run,
      candidates: candidatesR.rows,
      interview,
      caseMeta: {
        case_id: caseId,
        ...labels,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/admin/client-access/start-case/assign-advocate
 * body: { caseId, advocateId }
 */
export async function adminAssignAdvocateToCase(req, res) {
  const clientTitle = "✅ Advocate Assigned to Your Case";
  const advocateTitle = "📌 New Case Assigned";

  const dbClient = await pool.connect();
  try {
    const { caseId, advocateId } = req.body || {};
    if (!caseId) return res.status(400).json({ error: "caseId is required" });
    if (!advocateId) return res.status(400).json({ error: "advocateId is required" });

    await dbClient.query("BEGIN");

    // 1) load case
    const c = await dbClient.query(
      `
      SELECT id, user_id, assigned_advocate_id, preferred_advocate_id
      FROM public.client_cases
      WHERE id=$1
      FOR UPDATE
      `,
      [Number(caseId)]
    );

    if (c.rows.length === 0) {
      await dbClient.query("ROLLBACK");
      return res.status(404).json({ error: "Case not found" });
    }

    const clientUserId = c.rows[0].user_id;
    const alreadyAssigned = c.rows[0].assigned_advocate_id;
    const preferredAdvocateId = c.rows[0].preferred_advocate_id;

    if (preferredAdvocateId && Number(preferredAdvocateId) !== Number(advocateId)) {
      await dbClient.query("ROLLBACK");
      return res.status(409).json({
        error: "Client selected a different preferred advocate. Please approve that advocate or clear preference first.",
      });
    }

    if (alreadyAssigned && Number(alreadyAssigned) === Number(advocateId)) {
      await dbClient.query("ROLLBACK");
      return res.json({ message: "Advocate already assigned to this case" });
    }

    // 2) update case (✅ correct column)
    await dbClient.query(
      `
      UPDATE public.client_cases
      SET assigned_advocate_id=$2,
          updated_at=NOW()
      WHERE id=$1
      `,
      [Number(caseId), Number(advocateId)]
    );

    await transitionCaseStatus(dbClient, {
      caseId: Number(caseId),
      toStatus: CASE_STATUS.ADVOCATE_ASSIGNED,
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || "ADMIN",
      reason: "Admin assigned advocate",
      metadata: {
        advocateId: Number(advocateId),
      },
    });

    await dbClient.query("COMMIT");

    // 3) fetch users
    const clientUser = await pool.query(
      `SELECT email, name FROM public.users WHERE id=$1`,
      [Number(clientUserId)]
    );

    const advocateUser = await pool.query(
      `SELECT email, name FROM public.users WHERE id=$1`,
      [Number(advocateId)]
    );

    const clientEmail = clientUser.rows?.[0]?.email;
    const advocateEmail = advocateUser.rows?.[0]?.email;

    const clientName = clientUser.rows?.[0]?.name || "Client";
    const advocateName = advocateUser.rows?.[0]?.name || "Advocate";

    // 4) client DB notification
    await pool.query(
      `
      INSERT INTO public.client_notifications
        (user_id, title, description, type, priority, is_read, created_at)
      VALUES ($1,$2,$3,'CASE','HIGH',false,NOW())
      `,
      [
        Number(clientUserId),
        clientTitle,
        `Advocate ${advocateName} has been assigned to your case #${caseId}.`,
      ]
    );

    // 5) advocate DB notification (optional)
    await notifyAdvocateInDb({
      advocateId,
      title: advocateTitle,
      message: `You have been assigned case #${caseId} for client ${clientName}.`,
    });

    // 6) emails (best effort)
    if (clientEmail) {
      sendNotificationEmail({
        to: clientEmail,
        subject: clientTitle,
        title: clientTitle,
        message: `
          <p>Hi ${clientName},</p>
          <p>Your case <b>#${caseId}</b> has been assigned.</p>
          <p><b>Advocate:</b> ${advocateName}</p>
        `,
      }).catch(() => {});
    }

    if (advocateEmail) {
      sendNotificationEmail({
        to: advocateEmail,
        subject: advocateTitle,
        title: advocateTitle,
        message: `
          <p>Hi ${advocateName},</p>
          <p>You have been assigned a new case.</p>
          <p><b>Case:</b> #${caseId}</p>
          <p><b>Client:</b> ${clientName}</p>
        `,
      }).catch(() => {});
    }

    return res.json({ message: "✅ Advocate assigned successfully" });
  } catch (err) {
    try {
      await dbClient.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
}
