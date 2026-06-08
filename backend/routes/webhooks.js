// backend/routes/webhooks.js
import express from "express";
import { createHash } from "crypto";
import pool from "../db.js";

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

function inferCompletionSource(req) {
    const ua = String(req.headers["user-agent"] || "").toLowerCase();
    if (ua.includes("voiceinterviewagent") || ua.includes("voice-intake-agent")) return "webhook";
    return "webhook";
}

// POST /api/webhooks/interview-complete — Receive results from voice service
router.post("/interview-complete", async (req, res) => {
    try {
        // Verify webhook secret
        const secret = req.headers["x-webhook-secret"];
        const expected = process.env.VOICE_WEBHOOK_SECRET;

        if (expected && secret !== expected) {
            console.warn("Webhook secret mismatch");
            return res.status(401).json({ error: "Invalid webhook secret" });
        }

        const { session_id, transcript, analysis, audio_url, audio_duration_seconds } = req.body;

        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const resultHash = computeResultHash(session_id, transcript || null, analysis || null);
        const completionSource = inferCompletionSource(req);

        console.log(`Webhook received for session: ${session_id}`, {
            completionSource,
            hasTranscript: !!transcript,
            hasAnalysis: !!analysis,
            resultHashPrefix: resultHash.slice(0, 12),
        });

        // Update case_intake_sessions
        const updateResult = await pool.query(
            `UPDATE case_intake_sessions
       SET transcript = $1,
           analysis = $2,
           audio_url = $3,
           audio_duration = $4,
           status = 'COMPLETED',
           completed_at = NOW(),
           completion_source = COALESCE(completion_source, $6),
           webhook_received_at = NOW(),
           result_hash = COALESCE($7, result_hash),
           updated_at = NOW()
        WHERE session_id = $5
       RETURNING id, case_id, completion_source, result_hash`,
            [
                transcript || null,
                analysis ? JSON.stringify(analysis) : null,
                audio_url || null,
                audio_duration_seconds || null,
                session_id,
                completionSource,
                resultHash,
            ]
        );

        // If we have a case_id and analysis, update client_cases too
        if (updateResult.rows.length > 0) {
            const { case_id } = updateResult.rows[0];

            if (case_id && analysis) {
                await pool.query(
                    `UPDATE client_cases
           SET legal_domain = COALESCE($1, legal_domain),
               interview_completed = true,
               updated_at = NOW()
           WHERE id = $2`,
                    [analysis.legal_domain || null, case_id]
                ).catch((e) => console.error("Failed to update client_cases:", e));
            }
        }

        if (updateResult.rows.length > 0) {
            const row = updateResult.rows[0];
            console.log("Interview persisted via webhook", {
                sessionId: session_id,
                completionSource: row.completion_source,
                resultHashPrefix: String(row.result_hash || "").slice(0, 12),
            });
        } else {
            console.warn("Webhook session not found for update", { sessionId: session_id });
        }

        res.json({
            message: "Webhook processed successfully",
            session_id,
            persisted: updateResult.rows.length > 0,
            source: completionSource,
            result_hash: resultHash,
        });
    } catch (error) {
        console.error("Webhook processing error:", error);
        res.status(500).json({ error: "Failed to process webhook" });
    }
});

// GET /api/webhooks/health — Health check
router.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "insafdaar-webhook",
        timestamp: new Date().toISOString(),
    });
});

export default router;
