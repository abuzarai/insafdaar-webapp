// backend/routes/interviews.js
import express from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import pool from "../db.js";
import { createHash } from "crypto";

const router = express.Router();

function toCanonicalJson(value) {
    if (value === null || value === undefined) return "null";
    if (Array.isArray(value)) {
        return `[${value.map((v) => toCanonicalJson(v)).join(",")}]`;
    }
    if (typeof value === "object") {
        const keys = Object.keys(value).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${toCanonicalJson(value[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function computeResultHash(sessionId, transcript, analysis) {
    const base = `${sessionId || ""}|${transcript || ""}|${toCanonicalJson(analysis || null)}`;
    return createHash("sha256").update(base).digest("hex");
}

// POST /api/interviews/start — Store session reference
router.post("/start", authMiddleware, async (req, res) => {
    try {
        const { sessionId, caseId, wsUrl, language } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: "sessionId is required" });
        }

        // Interviews are private to the case owner: verify before linking.
        if (caseId) {
            const owned = await pool.query(
                "SELECT id FROM client_cases WHERE id=$1 AND user_id=$2",
                [Number(caseId), req.user.id]
            );
            if (owned.rows.length === 0) {
                return res.status(404).json({ error: "Case not found" });
            }
        }

        const result = await pool.query(
            `INSERT INTO case_intake_sessions
         (session_id, case_id, user_id, ws_url, language, mode, status)
       VALUES ($1, $2, $3, $4, $5, 'voice_ai', 'STARTED')
       ON CONFLICT (session_id) DO UPDATE SET updated_at = NOW()
       RETURNING id, session_id, status, created_at`,
            [sessionId, caseId || null, req.user?.id || null, wsUrl || null, language || "English"]
        );

        res.status(201).json({
            message: "Session stored",
            session: result.rows[0],
        });
    } catch (error) {
        console.error("Error storing interview session:", error);
        res.status(500).json({ error: "Failed to store interview session" });
    }
});

// GET /api/interviews/:sessionId — Get session details
router.get("/:sessionId", authMiddleware, async (req, res) => {
    try {
        const { sessionId } = req.params;

        // Sessions are private to the owner (case owner or session creator).
        const result = await pool.query(
            `SELECT * FROM case_intake_sessions WHERE session_id = $1 AND user_id = $2`,
            [sessionId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error fetching session:", error);
        res.status(500).json({ error: "Failed to fetch session" });
    }
});

// GET /api/interviews/case/:caseId — Get all sessions for a case
router.get("/case/:caseId", authMiddleware, async (req, res) => {
    try {
        const { caseId } = req.params;

        const result = await pool.query(
            `SELECT * FROM case_intake_sessions
       WHERE case_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
            [caseId, req.user.id]
        );

        res.json({ sessions: result.rows });
    } catch (error) {
        console.error("Error fetching sessions for case:", error);
        res.status(500).json({ error: "Failed to fetch sessions" });
    }
});

// POST /api/interviews/complete — Fallback persistence from frontend when webhook misses
router.post("/complete", authMiddleware, async (req, res) => {
    try {
        const { sessionId, caseId, transcript, analysis, audioUrl } = req.body || {};

        if (!sessionId) {
            return res.status(400).json({ error: "sessionId is required" });
        }

        // ── Ownership checks before any write ────────────────────────
        // The fallback path is caller-driven (the client's own JWT), so the
        // session and the target case must both belong to the caller.
        const sessionRow = await pool.query(
            "SELECT id, user_id, case_id FROM case_intake_sessions WHERE session_id = $1",
            [sessionId]
        );
        if (sessionRow.rows.length > 0 && Number(sessionRow.rows[0].user_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: "Forbidden" });
        }
        const sessionCaseId = sessionRow.rows[0]?.case_id
            ? Number(sessionRow.rows[0].case_id)
            : null;
        const targetCaseId = caseId ? Number(caseId) : sessionCaseId;
        if (targetCaseId) {
            const owned = await pool.query(
                "SELECT id FROM client_cases WHERE id=$1 AND user_id=$2",
                [targetCaseId, req.user.id]
            );
            if (owned.rows.length === 0) {
                return res.status(403).json({ error: "Forbidden" });
            }
        }

        const normalizedTranscript = transcript ? String(transcript) : null;
        const normalizedAnalysis = analysis && typeof analysis === "object" ? analysis : null;
        const normalizedAudioUrl = audioUrl ? String(audioUrl) : null;
        const completionSource = "fallback";
        const resultHash = computeResultHash(sessionId, normalizedTranscript, normalizedAnalysis);

        console.log("Interview completion fallback received", {
            sessionId,
            caseId: caseId || null,
            hasTranscript: !!normalizedTranscript,
            hasAnalysis: !!normalizedAnalysis,
            resultHashPrefix: resultHash.slice(0, 12),
        });

        const upd = await pool.query(
            `UPDATE case_intake_sessions
             SET transcript = COALESCE($1, transcript),
                 analysis = COALESCE($2::jsonb, analysis),
                 audio_url = COALESCE($3, audio_url),
                 status = CASE
                   WHEN COALESCE($1, transcript) IS NOT NULL OR COALESCE($2::jsonb, analysis) IS NOT NULL THEN 'COMPLETED'
                   ELSE status
                 END,
                 completed_at = CASE
                   WHEN COALESCE($1, transcript) IS NOT NULL OR COALESCE($2::jsonb, analysis) IS NOT NULL THEN COALESCE(completed_at, NOW())
                   ELSE completed_at
                 END,
                 completion_source = COALESCE(completion_source, $5),
                 fallback_received_at = NOW(),
                 result_hash = COALESCE($6, result_hash),
                 updated_at = NOW()
             WHERE session_id = $4
             RETURNING id, case_id, session_id, status, completed_at, completion_source, result_hash`,
            [
                normalizedTranscript,
                normalizedAnalysis ? JSON.stringify(normalizedAnalysis) : null,
                normalizedAudioUrl,
                sessionId,
                completionSource,
                resultHash,
            ]
        );

        let finalCaseId = caseId ? Number(caseId) : null;
        if (!finalCaseId && upd.rows[0]?.case_id) {
            finalCaseId = Number(upd.rows[0].case_id);
        }

        if (!upd.rows[0] && finalCaseId) {
            const ins = await pool.query(
                `INSERT INTO case_intake_sessions
                   (session_id, case_id, user_id, mode, status, transcript, analysis, audio_url, completed_at, completion_source, fallback_received_at, result_hash)
                 VALUES ($1, $2, $3, 'voice_ai', 'COMPLETED', $4, $5::jsonb, $6, NOW(), $7, NOW(), $8)
                 ON CONFLICT (session_id)
                 DO UPDATE SET
                   transcript = COALESCE(EXCLUDED.transcript, case_intake_sessions.transcript),
                   analysis = COALESCE(EXCLUDED.analysis, case_intake_sessions.analysis),
                   audio_url = COALESCE(EXCLUDED.audio_url, case_intake_sessions.audio_url),
                   status = 'COMPLETED',
                   completed_at = COALESCE(case_intake_sessions.completed_at, NOW()),
                   completion_source = COALESCE(case_intake_sessions.completion_source, EXCLUDED.completion_source),
                   fallback_received_at = NOW(),
                   result_hash = COALESCE(case_intake_sessions.result_hash, EXCLUDED.result_hash),
                   updated_at = NOW()
                 RETURNING id, case_id, session_id, status, completed_at, completion_source, result_hash`,
                [
                    sessionId,
                    finalCaseId,
                    req.user?.id || null,
                    normalizedTranscript,
                    normalizedAnalysis ? JSON.stringify(normalizedAnalysis) : null,
                    normalizedAudioUrl,
                    completionSource,
                    resultHash,
                ]
            );
            upd.rows[0] = ins.rows[0];
        }

        if (!upd.rows[0]) {
            return res.status(404).json({ error: "Session not found and caseId missing for fallback create" });
        }

        const resolvedCaseId = Number(upd.rows[0].case_id || finalCaseId || 0) || null;
        if (resolvedCaseId) {
            await pool.query(
                `UPDATE client_cases
                 SET legal_domain = COALESCE($1, legal_domain),
                     interview_completed = CASE
                       WHEN $2::text IS NOT NULL OR $3::jsonb IS NOT NULL THEN true
                       ELSE interview_completed
                     END,
                     updated_at = NOW()
                 WHERE id = $4`,
                [
                    normalizedAnalysis?.legal_domain || null,
                    normalizedTranscript,
                    normalizedAnalysis ? JSON.stringify(normalizedAnalysis) : null,
                    resolvedCaseId,
                ]
            );
        }

        if (upd.rows[0]) {
            console.log("Interview completion persisted via fallback", {
                sessionId,
                caseId: upd.rows[0].case_id || resolvedCaseId,
                completionSource: upd.rows[0].completion_source,
                resultHashPrefix: String(upd.rows[0].result_hash || "").slice(0, 12),
            });
        }

        return res.json({
            message: "Interview completion persisted",
            session: upd.rows[0],
            source: completionSource,
            result_hash: resultHash,
        });
    } catch (error) {
        console.error("Error persisting interview completion:", error);
        return res.status(500).json({ error: "Failed to persist interview completion" });
    }
});

export default router;
