import pool from "../../../db.js";

async function assertClientOwnsCase(userId, caseIdRaw) {
  const caseId = Number(caseIdRaw);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return { ok: false, status: 400, payload: { error: "Invalid caseId" } };
  }

  const r = await pool.query(
    `
      SELECT id
      FROM public.client_cases
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [caseId, Number(userId)]
  );

  if (!r.rowCount) {
    return { ok: false, status: 404, payload: { error: "Case not found" } };
  }

  return { ok: true, caseDbId: Number(r.rows[0].id) };
}

function mapPaymentGateFromCase(caseRow) {
  const paymentStatus = String(caseRow?.payment_status || "UNPAID").toUpperCase();
  const computed = String(caseRow?.payment_status_computed || "UNPAID").toUpperCase();
  const override = caseRow?.payment_manual_override_status || null;
  const verifiedTotal = Number(caseRow?.payment_verified_total || 0);

  const unlocked = paymentStatus === "FULLY_PAID" || paymentStatus === "MANUALLY_MARKED_PAID";

  const reason = unlocked
    ? null
    : "Payment is not verified yet. Please upload payment proof in Billing and wait for admin verification.";

  return {
    unlocked,
    reason,
    payment: {
      paymentStatus: paymentStatus || "UNPAID",
      paymentStatusComputed: computed || "UNPAID",
      paymentRequiredTotal: Number(caseRow?.payment_required_total || 0),
      paymentVerifiedTotal: verifiedTotal,
      manualOverrideStatus: override,
      manualOverrideNote: caseRow?.payment_manual_override_note || null,
      manualOverrideAt: caseRow?.payment_manual_override_at || null,
    },
  };
}

export async function caseDetailsAccess(req, res) {
  try {
    const userId = Number(req.user?.id || 0);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const owned = await assertClientOwnsCase(userId, req.query.caseId);
    if (!owned.ok) return res.status(owned.status).json(owned.payload);

    const c = await pool.query(
      `
        SELECT
          id,
          payment_required_total,
          payment_verified_total,
          payment_status,
          payment_status_computed,
          payment_manual_override_status,
          payment_manual_override_note,
          payment_manual_override_at
        FROM public.client_cases
        WHERE id = $1
          AND user_id = $2
      `,
      [owned.caseDbId, userId]
    );

    if (!c.rowCount) return res.status(404).json({ error: "Case not found" });

    const gate = mapPaymentGateFromCase(c.rows[0]);

    if (!gate.unlocked) {
      return res.status(403).json({
        error: "PAYMENT_NOT_VERIFIED",
        message: gate.reason,
        unlocked: false,
        payment: gate.payment,
      });
    }

    return res.json({
      ok: true,
      unlocked: true,
      payment: gate.payment,
    });
  } catch (e) {
    console.error("caseDetailsAccess error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getCaseDetails(req, res) {
  try {
    const userId = Number(req.user?.id || 0);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const owned = await assertClientOwnsCase(userId, req.query.caseId);
    if (!owned.ok) return res.status(owned.status).json(owned.payload);

    const caseR = await pool.query(
      `
        SELECT
          c.id,
          c.user_id,
          c.title,
          c.description,
          c.status,
          c.source,
          c.language,
          c.created_at,
          c.updated_at,
          c.assigned_advocate_id,
          c.payment_required_total,
          c.payment_verified_total,
          c.payment_status,
          c.payment_status_computed,
          c.payment_manual_override_status,
          c.payment_manual_override_note,
          c.payment_manual_override_at,

          u.name AS client_name,
          u.email AS client_email,
          cp.phone AS client_phone,
          cp.city AS client_city,

          a.name AS advocate_name,
          a.email AS advocate_email,
          ap.phone AS advocate_phone
        FROM public.client_cases c
        JOIN public.users u ON u.id = c.user_id
        LEFT JOIN public.client_profiles cp ON cp.user_id = c.user_id
        LEFT JOIN public.users a ON a.id = c.assigned_advocate_id
        LEFT JOIN public.advocate_profiles ap ON ap.user_id = c.assigned_advocate_id
        WHERE c.id = $1
          AND c.user_id = $2
      `,
      [owned.caseDbId, userId]
    );

    if (!caseR.rowCount) return res.status(404).json({ error: "Case not found" });
    const caseRow = caseR.rows[0];

    const paymentGate = mapPaymentGateFromCase(caseRow);

    const [vouchersR, meetingsR, contractR, contractSigsR, contractAttachmentsR, docsR, voiceR, intakeR, eventsR] = await Promise.all([
      pool.query(
        `
          SELECT
            b.id,
            b.case_id,
            b.title,
            b.description,
            b.amount,
            b.status,
            b.due_date,
            b.voucher_pdf_url,
            b.is_installment,
            b.sequence_no,
            b.issued_at,
            b.verified_at,
            b.rejection_note,
            b.created_at,
            b.updated_at,
            p.id AS latest_proof_id,
            p.proof_file_url AS latest_proof_file_url,
            p.status AS latest_proof_status,
            p.created_at AS latest_proof_uploaded_at
          FROM public.client_billing b
          LEFT JOIN LATERAL (
            SELECT pp.id, pp.proof_file_url, pp.status, pp.created_at
            FROM public.client_payment_proofs pp
            WHERE pp.billing_id = b.id
            ORDER BY pp.created_at DESC, pp.id DESC
            LIMIT 1
          ) p ON TRUE
          WHERE b.user_id = $1
            AND b.case_id = $2
          ORDER BY b.sequence_no ASC, b.created_at ASC, b.id ASC
        `,
        [userId, owned.caseDbId]
      ),
      pool.query(
        `
          SELECT
            id,
            case_id,
            start_at,
            end_at,
            google_meet_link,
            status,
            approved_at,
            created_at
          FROM public.case_meetings
          WHERE case_id = $1
          ORDER BY COALESCE(start_at, created_at) DESC, id DESC
        `,
        [owned.caseDbId]
      ),
      pool.query(
        `
          SELECT
            id,
            case_id,
            version_no,
            title,
            contract_text,
            status,
            approved_by,
            approved_at,
            approval_note,
            rejection_note,
            created_at,
            updated_at
          FROM public.case_contracts
          WHERE case_id = $1
          ORDER BY version_no DESC, id DESC
          LIMIT 1
        `,
        [owned.caseDbId]
      ),
      pool.query(
        `
          SELECT
            id,
            contract_id,
            signer_user_id,
            signer_role,
            typed_full_name,
            signed_at,
            confirmed_read_understood,
            confirmed_voluntary,
            confirmed_typed_signature,
            confirmed_reviewed_attachments
          FROM public.case_contract_signatures
          WHERE contract_id = (
            SELECT id
            FROM public.case_contracts
            WHERE case_id = $1
            ORDER BY version_no DESC, id DESC
            LIMIT 1
          )
          ORDER BY signed_at DESC, id DESC
        `,
        [owned.caseDbId]
      ),
      pool.query(
        `
          SELECT
            id,
            contract_id,
            case_id,
            version_no,
            file_name,
            file_path,
            mime_type,
            file_size,
            created_at
          FROM public.case_contract_attachments
          WHERE contract_id = (
            SELECT id
            FROM public.case_contracts
            WHERE case_id = $1
            ORDER BY version_no DESC, id DESC
            LIMIT 1
          )
          ORDER BY created_at DESC, id DESC
        `,
        [owned.caseDbId]
      ),
      pool.query(
        `
          SELECT
            id,
            doc_type,
            file_url,
            status,
            note,
            COALESCE(updated_at, created_at) AS uploaded_at
          FROM public.case_documents
          WHERE case_id = $1
          ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
        `,
        [owned.caseDbId]
      ),
      pool.query(
        `
          SELECT id, language, audio_url, notes, created_at
          FROM public.case_voice_notes
          WHERE case_id = $1
          ORDER BY created_at DESC, id DESC
        `,
        [owned.caseDbId]
      ),
      pool.query(
        `
          SELECT id, transcript, analysis, language, status, created_at
          FROM public.case_intake_sessions
          WHERE case_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `,
        [owned.caseDbId]
      ),
      pool.query(
        `
          SELECT
            l.id,
            l.from_status,
            l.to_status,
            l.actor_user_id,
            l.actor_role,
            l.reason,
            l.metadata,
            l.created_at
          FROM public.case_lifecycle_events l
          WHERE l.case_id = $1
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT 120
        `,
        [owned.caseDbId]
      ),
    ]);

    const contract = contractR.rows[0] || null;
    const contractId = contract?.id ? Number(contract.id) : null;
    const contractVersion = contract?.version_no ? Number(contract.version_no) : null;

    const latestContractSignatures = contractSigsR.rows;

    const latestContractAttachments = contractAttachmentsR.rows;

    return res.json({
      ok: true,
      unlocked: paymentGate.unlocked,
      case: {
        id: Number(caseRow.id),
        title: caseRow.title,
        description: caseRow.description,
        status: caseRow.status,
        source: caseRow.source,
        language: caseRow.language,
        createdAt: caseRow.created_at,
        updatedAt: caseRow.updated_at,
        client: {
          userId: Number(caseRow.user_id),
          name: caseRow.client_name,
          email: caseRow.client_email,
          phone: caseRow.client_phone || null,
          city: caseRow.client_city || null,
        },
        advocate: caseRow.assigned_advocate_id
          ? {
              assigned: true,
              userId: Number(caseRow.assigned_advocate_id),
              name: caseRow.advocate_name || null,
              email: caseRow.advocate_email || null,
              phone: caseRow.advocate_phone || null,
            }
          : {
              assigned: false,
            },
      },
      payment: paymentGate.payment,
      vouchers: vouchersR.rows,
      meetings: meetingsR.rows,
      contract: contract
        ? {
            id: contractId,
            caseId: Number(contract.case_id),
            versionNo: contractVersion,
            title: contract.title,
            contractText: contract.contract_text,
            status: contract.status,
            approvedBy: contract.approved_by,
            approvedAt: contract.approved_at,
            approvalNote: contract.approval_note,
            rejectionNote: contract.rejection_note,
            createdAt: contract.created_at,
            updatedAt: contract.updated_at,
            signatures: latestContractSignatures,
            attachments: latestContractAttachments,
          }
        : null,
      documents: docsR.rows,
      voiceNotes: voiceR.rows,
      intake: intakeR.rows[0]
        ? {
            id: intakeR.rows[0].id,
            transcript: intakeR.rows[0].transcript || null,
            extracted_entities:
              intakeR.rows[0].analysis?.extractedEntities ||
              intakeR.rows[0].analysis?.entities ||
              intakeR.rows[0].analysis?.key_entities ||
              [],
            domain: intakeR.rows[0].analysis?.domain || intakeR.rows[0].analysis?.legal_domain || null,
            complexity:
              intakeR.rows[0].analysis?.complexity ||
              intakeR.rows[0].analysis?.urgency ||
              null,
            status: intakeR.rows[0].status || null,
            language: intakeR.rows[0].language || null,
            created_at: intakeR.rows[0].created_at,
          }
        : null,
      timeline: eventsR.rows,
    });
  } catch (e) {
    console.error("getCaseDetails error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}
