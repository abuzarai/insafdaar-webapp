import fs from "fs";
import path from "path";
import pool from "../../../db.js";
import { CASE_STATUS, transitionCaseStatus } from "../../../utils/caseLifecycle.js";
import { notifyClient, notifyAllAdmins } from "../../../utils/notify.js";
import {
  buildOtpSessionToken,
  generateOtpCode,
  getOtpConfig,
  hashCanonicalText,
  hashOtp,
  verifyOtpSessionToken,
} from "../../../utils/contractSigning.js";
import { sendContractSigningOtpEmail } from "../../../utils/mailer.js";
import PDFDocument from "pdfkit";
import { ensureContractTables, getLatestContract, getContractSignatures, getContractAttachments,
  logContractEvent, serializeContract, parseSignConfirmations, assertAllSignConfirmations } from "../../../services/contractService.js";
import { getDraftingAssistantBaseUrl, getDraftingTimeoutMs, callDraftingAssistant, fetchDraftJob } from "../../../services/draftingClient.js";

const CONTRACT_DRAFT_DOC_TYPE = "Client-Lawyer Contract";

const CONTRACT_UPLOAD_DIR = path.resolve("uploads/contracts");
fs.mkdirSync(CONTRACT_UPLOAD_DIR, { recursive: true });

let contractTablesReady = false;

async function getAssignedCase(client, caseId, advocateId) {
  const r = await client.query(
    `
      SELECT id, user_id, assigned_advocate_id, status
      FROM public.client_cases
      WHERE id = $1
    `,
    [Number(caseId)]
  );

  const row = r.rows[0];
  if (!row) {
    const err = new Error("Case not found");
    err.status = 404;
    throw err;
  }
  if (Number(row.assigned_advocate_id) !== Number(advocateId)) {
    const err = new Error("Forbidden");
    err.status = 403;
    throw err;
  }
  return row;
}

export async function getCaseContractForAdvocate(req, res) {
  const client = await pool.connect();
  try {
    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    await getAssignedCase(client, caseId, advocateId);
    const contract = await getLatestContract(client, caseId);
    if (!contract) return res.json({ contract: null });

    const [signatures, attachments] = await Promise.all([
      getContractSignatures(client, contract.id),
      getContractAttachments(client, contract.id),
    ]);
    return res.json({ contract: serializeContract(contract, signatures, attachments) });
  } catch (err) {
    return res.status(err?.status || 500).json({ error: err.message || "Failed to load contract" });
  } finally {
    client.release();
  }
}

export async function upsertCaseContractByAdvocate(req, res) {
  const client = await pool.connect();
  try {

    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const title = req.body?.title ? String(req.body.title).trim() : null;
    const contractText = String(req.body?.contractText || "").trim();
    if (!contractText) return res.status(400).json({ error: "contractText is required" });

    await client.query("BEGIN");

    const caseRow = await getAssignedCase(client, caseId, advocateId);
    const latest = await getLatestContract(client, caseId);
    let contract = latest;
    let createdNewVersion = false;

    if (!latest) {
      const ins = await client.query(
        `
          INSERT INTO public.case_contracts
            (case_id, version_no, title, contract_text, status, drafted_by, updated_by, created_at, updated_at)
          VALUES ($1, 1, $2, $3, 'DRAFT', $4, $4, NOW(), NOW())
          RETURNING *
        `,
        [caseId, title, contractText, advocateId]
      );
      contract = ins.rows[0];
    } else {
      const sigCount = await client.query(
        `SELECT COUNT(*)::int AS count FROM public.case_contract_signatures WHERE contract_id = $1`,
        [latest.id]
      );

      if (Number(sigCount.rows[0]?.count || 0) > 0) {
        const nextVersionNo = Number(latest.version_no || 1) + 1;
        const insV = await client.query(
          `
            INSERT INTO public.case_contracts
              (case_id, version_no, title, contract_text, status, drafted_by, updated_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 'DRAFT', $5, $5, NOW(), NOW())
            RETURNING *
          `,
          [caseId, nextVersionNo, title || latest.title || null, contractText, advocateId]
        );
        contract = insV.rows[0];
        createdNewVersion = true;
      } else {
        const upd = await client.query(
          `
            UPDATE public.case_contracts
            SET title = COALESCE($2, title),
                contract_text = $3,
                status = 'DRAFT',
                updated_by = $4,
                updated_at = NOW(),
                rejection_note = NULL
            WHERE id = $1
            RETURNING *
          `,
          [latest.id, title, contractText, advocateId]
        );
        contract = upd.rows[0];
      }
    }

    await logContractEvent(client, {
      contractId: contract.id,
      caseId,
      eventType: createdNewVersion ? "CONTRACT_NEW_VERSION_CREATED" : "CONTRACT_UPSERTED_BY_ADVOCATE",
      actorUserId: advocateId,
      actorRole: req.user?.role || "ADVOCATE",
      details: { title: contract.title, versionNo: contract.version_no },
    });

    if (String(caseRow.status || "").toUpperCase() !== CASE_STATUS.CONTRACT_PENDING_SIGNATURES) {
      await transitionCaseStatus(client, {
        caseId,
        toStatus: CASE_STATUS.CONTRACT_PENDING_SIGNATURES,
        actorUserId: advocateId,
        actorRole: req.user?.role || "ADVOCATE",
        reason: "Contract drafted and shared for signatures",
        metadata: { contractId: contract.id, versionNo: contract.version_no },
      });
    }

    await client.query("COMMIT");

    await notifyClient({
      userId: caseRow.user_id,
      title: createdNewVersion ? "Contract Updated - Re-sign Required" : "Contract Draft Ready for Signature",
      message: createdNewVersion
        ? `Contract for case #${caseId} was updated to version v${contract.version_no}. Please review and sign again.`
        : `Your advocate has prepared the contract for case #${caseId}. Please review and sign from your dashboard.`,
      type: "CASE",
      priority: "HIGH",
    }).catch(() => {});

    const [signatures, attachments] = await Promise.all([
      getContractSignatures(client, contract.id),
      getContractAttachments(client, contract.id),
    ]);
    return res.json({ message: "Contract saved", contract: serializeContract(contract, signatures, attachments) });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(err?.status || 500).json({ error: err.message || "Failed to save contract" });
  } finally {
    client.release();
  }
}

export async function uploadCaseContractAttachmentByAdvocate(req, res) {
  const client = await pool.connect();
  try {
    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });
    if (!req.file) return res.status(400).json({ error: "Attachment file is required" });

    await client.query("BEGIN");
    await getAssignedCase(client, caseId, advocateId);

    const contract = await getLatestContract(client, caseId);
    if (!contract) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Create contract text first, then upload attachments" });
    }

    const ins = await client.query(
      `
        INSERT INTO public.case_contract_attachments
          (contract_id, case_id, version_no, file_name, file_path, mime_type, file_size, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, file_name, file_path, mime_type, file_size, created_at
      `,
      [
        contract.id,
        caseId,
        contract.version_no,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        Number(req.file.size || 0),
        advocateId,
      ]
    );

    await logContractEvent(client, {
      contractId: contract.id,
      caseId,
      eventType: "CONTRACT_ATTACHMENT_UPLOADED",
      actorUserId: advocateId,
      actorRole: req.user?.role || "ADVOCATE",
      details: {
        attachmentId: ins.rows[0]?.id,
        fileName: req.file.originalname,
        versionNo: contract.version_no,
      },
    });

    await client.query("COMMIT");
    return res.status(201).json({ attachment: ins.rows[0] });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(err?.status || 500).json({ error: err.message || "Failed to upload attachment" });
  } finally {
    client.release();
  }
}

export async function requestContractSigningOtpByAdvocate(req, res) {
  const client = await pool.connect();
  try {
    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    const role = String(req.user?.role || "").toUpperCase();
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });
    if (role !== "ADVOCATE") return res.status(403).json({ error: "Forbidden" });

    await client.query("BEGIN");

    await getAssignedCase(client, caseId, advocateId);
    const contract = await getLatestContract(client, caseId);
    if (!contract) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contract not found" });
    }

    const userR = await client.query(`SELECT email FROM public.users WHERE id = $1`, [advocateId]);
    const email = userR.rows[0]?.email || null;
    if (!email) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "User email is required for OTP" });
    }

    const otpCode = generateOtpCode();
    const otpHash = hashOtp(otpCode);
    const config = getOtpConfig();

    const otpR = await client.query(
      `
        INSERT INTO public.case_contract_otps
          (contract_id, case_id, version_no, signer_user_id, signer_role, purpose, otp_hash, expires_at, max_attempts)
        VALUES ($1, $2, $3, $4, 'ADVOCATE', 'CONTRACT_SIGN', $5, NOW() + ($6::text || ' minutes')::interval, $7)
        RETURNING id, expires_at
      `,
      [contract.id, caseId, contract.version_no, advocateId, otpHash, String(config.ttlMinutes), config.maxAttempts]
    );

    await logContractEvent(client, {
      contractId: contract.id,
      caseId,
      eventType: "OTP_REQUESTED_BY_ADVOCATE",
      actorUserId: advocateId,
      actorRole: req.user?.role || "ADVOCATE",
      details: { otpId: otpR.rows[0]?.id, versionNo: contract.version_no },
    });

    await client.query("COMMIT");

    await sendContractSigningOtpEmail({
      to: email,
      otp: otpCode,
      caseId,
      versionNo: contract.version_no,
    }).catch(() => {});

    return res.json({
      otpRequestId: otpR.rows[0]?.id,
      expiresAt: otpR.rows[0]?.expires_at,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(err?.status || 500).json({ error: err.message || "Failed to request OTP" });
  } finally {
    client.release();
  }
}

export async function verifyContractSigningOtpByAdvocate(req, res) {
  const client = await pool.connect();
  try {
    const advocateId = Number(req.user?.id || 0);
    const role = String(req.user?.role || "").toUpperCase();
    if (role !== "ADVOCATE") return res.status(403).json({ error: "Forbidden" });

    const otpRequestId = Number(req.body?.otpRequestId);
    const otpCode = String(req.body?.otpCode || "").trim();
    if (!otpRequestId || !otpCode) {
      return res.status(400).json({ error: "otpRequestId and otpCode are required" });
    }

    await client.query("BEGIN");

    const otpR = await client.query(
      `
        SELECT *
        FROM public.case_contract_otps
        WHERE id = $1
          AND signer_user_id = $2
          AND signer_role = 'ADVOCATE'
          AND purpose = 'CONTRACT_SIGN'
        FOR UPDATE
      `,
      [otpRequestId, advocateId]
    );

    const otp = otpR.rows[0];
    if (!otp) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "OTP request not found" });
    }
    if (otp.consumed_at) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "OTP already used" });
    }
    if (new Date(otp.expires_at).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "OTP expired" });
    }
    if (Number(otp.attempt_count || 0) >= Number(otp.max_attempts || 5)) {
      await client.query("ROLLBACK");
      return res.status(429).json({ error: "Maximum OTP attempts exceeded" });
    }

    const incomingHash = hashOtp(otpCode);
    if (incomingHash !== String(otp.otp_hash)) {
      await client.query(`UPDATE public.case_contract_otps SET attempt_count = attempt_count + 1 WHERE id = $1`, [otp.id]);
      await client.query("COMMIT");
      return res.status(400).json({ error: "Invalid OTP code" });
    }

    await client.query(`UPDATE public.case_contract_otps SET consumed_at = NOW() WHERE id = $1`, [otp.id]);

    const otpSessionId = buildOtpSessionToken({
      otpId: otp.id,
      contractId: otp.contract_id,
      caseId: otp.case_id,
      versionNo: otp.version_no,
      signerUserId: otp.signer_user_id,
      signerRole: otp.signer_role,
    });

    await logContractEvent(client, {
      contractId: otp.contract_id,
      caseId: otp.case_id,
      eventType: "OTP_VERIFIED_BY_ADVOCATE",
      actorUserId: advocateId,
      actorRole: req.user?.role || "ADVOCATE",
      details: { otpId: otp.id, versionNo: otp.version_no },
    });

    await client.query("COMMIT");

    return res.json({ otpSessionId });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(err?.status || 500).json({ error: err.message || "Failed to verify OTP" });
  } finally {
    client.release();
  }
}

export async function signCaseContractByAdvocate(req, res) {
  const client = await pool.connect();
  try {

    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const typedFullName = String(req.body?.typedFullName || "").trim();
    const consentChecked = Boolean(req.body?.consentChecked);
    const signatureNote = req.body?.signatureNote ? String(req.body.signatureNote).trim() : null;
    const otpSessionId = String(req.body?.otpSessionId || "").trim();
    const confirmations = parseSignConfirmations(req.body);

    if (!typedFullName) return res.status(400).json({ error: "typedFullName is required" });
    if (!consentChecked) return res.status(400).json({ error: "consentChecked must be true" });
    if (!otpSessionId) return res.status(400).json({ error: "otpSessionId is required" });

    try {
      assertAllSignConfirmations(confirmations);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    await client.query("BEGIN");

    const caseRow = await getAssignedCase(client, caseId, advocateId);
    const contract = await getLatestContract(client, caseId);
    if (!contract) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contract not found" });
    }

    let otpPayload;
    try {
      otpPayload = verifyOtpSessionToken(otpSessionId);
    } catch (e) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: e.message || "Invalid otpSessionId" });
    }

    if (
      Number(otpPayload.signerUserId) !== advocateId ||
      String(otpPayload.signerRole || "").toUpperCase() !== "ADVOCATE" ||
      Number(otpPayload.caseId) !== Number(caseId) ||
      Number(otpPayload.contractId) !== Number(contract.id) ||
      Number(otpPayload.versionNo) !== Number(contract.version_no)
    ) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "otpSessionId does not match current contract version" });
    }

    const canonicalHash = hashCanonicalText(contract.contract_text);

    await client.query(
      `
        INSERT INTO public.case_contract_signatures
          (contract_id, case_id, signer_user_id, signer_role, typed_full_name, consent_checked, signature_note,
           ip_address, user_agent, contract_version_no, canonical_text_sha256_at_sign, otp_verified_at, otp_session_id,
           confirmed_read_understood, confirmed_voluntary, confirmed_typed_signature, confirmed_reviewed_attachments, signed_at)
        VALUES ($1, $2, $3, 'ADVOCATE', $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14, $15, NOW())
        ON CONFLICT (contract_id, signer_role)
        DO UPDATE SET
          signer_user_id = EXCLUDED.signer_user_id,
          typed_full_name = EXCLUDED.typed_full_name,
          consent_checked = EXCLUDED.consent_checked,
          signature_note = EXCLUDED.signature_note,
          ip_address = EXCLUDED.ip_address,
          user_agent = EXCLUDED.user_agent,
          contract_version_no = EXCLUDED.contract_version_no,
          canonical_text_sha256_at_sign = EXCLUDED.canonical_text_sha256_at_sign,
          otp_verified_at = NOW(),
          otp_session_id = EXCLUDED.otp_session_id,
          confirmed_read_understood = EXCLUDED.confirmed_read_understood,
          confirmed_voluntary = EXCLUDED.confirmed_voluntary,
          confirmed_typed_signature = EXCLUDED.confirmed_typed_signature,
          confirmed_reviewed_attachments = EXCLUDED.confirmed_reviewed_attachments,
          signed_at = NOW()
      `,
      [
        contract.id,
        caseId,
        advocateId,
        typedFullName,
        true,
        signatureNote,
        req.ip || null,
        req.get("user-agent") || null,
        contract.version_no,
        canonicalHash,
        otpSessionId,
        confirmations.confirmedReadUnderstood,
        confirmations.confirmedVoluntary,
        confirmations.confirmedTypedSignature,
        confirmations.confirmedReviewedAttachments,
      ]
    );

    const signatures = await getContractSignatures(client, contract.id);

    if (signatures.clientSignature && signatures.advocateSignature) {
      await client.query(
        `
          INSERT INTO public.case_contract_artifacts
            (contract_id, case_id, version_no, canonical_text_sha256, snapshot_json, generated_at)
          VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
          ON CONFLICT (contract_id, version_no)
          DO UPDATE SET
            canonical_text_sha256 = EXCLUDED.canonical_text_sha256,
            snapshot_json = EXCLUDED.snapshot_json,
            generated_at = NOW()
        `,
        [
          contract.id,
          caseId,
          contract.version_no,
          canonicalHash,
          JSON.stringify({
            caseId,
            contractId: contract.id,
            versionNo: contract.version_no,
            title: contract.title,
            contractText: contract.contract_text,
            signedByClientAt: signatures.clientSignature?.signed_at || null,
            signedByAdvocateAt: signatures.advocateSignature?.signed_at || null,
          }),
        ]
      );

      await client.query(
        `
          UPDATE public.case_contracts
          SET status = 'PENDING_ADMIN_APPROVAL',
              updated_by = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [contract.id, advocateId]
      );

      await transitionCaseStatus(client, {
        caseId,
        toStatus: CASE_STATUS.CONTRACT_PENDING_ADMIN_APPROVAL,
        actorUserId: advocateId,
        actorRole: req.user?.role || "ADVOCATE",
        reason: "Both parties signed contract",
        metadata: { contractId: contract.id, versionNo: contract.version_no, canonicalHash },
      });
    } else {
      await client.query(
        `
          UPDATE public.case_contracts
          SET status = 'PENDING_SIGNATURES',
              updated_by = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [contract.id, advocateId]
      );

      if (String(caseRow.status || "").toUpperCase() !== CASE_STATUS.CONTRACT_PENDING_SIGNATURES) {
        await transitionCaseStatus(client, {
          caseId,
          toStatus: CASE_STATUS.CONTRACT_PENDING_SIGNATURES,
          actorUserId: advocateId,
          actorRole: req.user?.role || "ADVOCATE",
          reason: "Contract signing started",
          metadata: { contractId: contract.id, versionNo: contract.version_no },
        });
      }
    }

    await logContractEvent(client, {
      contractId: contract.id,
      caseId,
      eventType: "ADVOCATE_SIGNED",
      actorUserId: advocateId,
      actorRole: req.user?.role || "ADVOCATE",
      details: { typedFullName, versionNo: contract.version_no },
    });

    await client.query("COMMIT");

    if (signatures.clientSignature && signatures.advocateSignature) {
      await notifyAllAdmins({
        title: "Contract Awaiting Admin Approval",
        message: `Case #${caseId} contract v${contract.version_no} has signatures from both client and advocate. Please review and approve.`,
        type: "CASE",
      }).catch(() => {});
    } else {
      await notifyClient({
        userId: caseRow.user_id,
        title: "Advocate Signed the Contract",
        message: `Your advocate has signed contract v${contract.version_no} for case #${caseId}. Please sign it to continue.`,
        type: "CASE",
        priority: "HIGH",
      }).catch(() => {});
    }

    const latest = await getLatestContract(client, caseId);
    const [latestSigs, latestAttachments] = await Promise.all([
      getContractSignatures(client, latest.id),
      getContractAttachments(client, latest.id),
    ]);
    return res.json({ message: "Contract signed successfully", contract: serializeContract(latest, latestSigs, latestAttachments) });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(err?.status || 500).json({ error: err.message || "Failed to sign contract" });
  } finally {
    client.release();
  }
}

export async function getLatestContractAIDraftByAdvocate(req, res) {
  const client = await pool.connect();
  try {
    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    await getAssignedCase(client, caseId, advocateId);

    const q = await client.query(
      `
      SELECT generation_id, document_type, draft_json, updated_at
      FROM public.draft_sessions
      WHERE case_id = $1
        AND advocate_id = $2
        AND LOWER(document_type) = LOWER($3)
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
      `,
      [caseId, advocateId, CONTRACT_DRAFT_DOC_TYPE]
    );

    const row = q.rows[0];
    if (!row) return res.json({ ok: true, draft: null });

    return res.json({
      ok: true,
      generation_id: row.generation_id,
      document_type: row.document_type,
      draft: row.draft_json,
      updated_at: row.updated_at,
    });
  } catch (err) {
    return res.status(err?.status || 500).json({ error: err.message || "Failed to load draft" });
  } finally {
    client.release();
  }
}

export async function generateContractAIDraftByAdvocate(req, res) {
  const client = await pool.connect();
  try {

    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const advocateNotes = String(req.body?.advocate_notes || "").trim();
    const language = String(req.body?.language || "English").trim() || "English";

    await getAssignedCase(client, caseId, advocateId);

    // Submit the generation as a background job: the request returns fast
    // with a job id, and the frontend polls GET .../ai-draft/jobs/:jobId.
    const queued = await callDraftingAssistant(
      "/draft/generate",
      {
        case_id: caseId,
        advocate_id: advocateId,
        document_type: CONTRACT_DRAFT_DOC_TYPE,
        advocate_notes: advocateNotes,
        language,
      },
      20000
    );
    if (!queued.ok) return res.status(queued.status).json(queued.payload);
    const jobId = queued.data?.job_id;
    if (!jobId) {
      return res.status(502).json({ error: "Drafting service did not return a job id" });
    }
    return res.json({ ok: true, job_id: jobId, status: "queued" });
  } catch (err) {
    return res.status(err?.status || 500).json({ error: err.message || "Failed to queue draft generation" });
  } finally {
    client.release();
  }
}

/**
 * GET /api/advocate/dashboard/contracts/cases/:caseId/ai-draft/jobs/:jobId
 * Polls the drafting service job; returns the generated draft when done.
 */
export async function getContractAIDraftStatusByAdvocate(req, res) {
  try {
    const advocateId = Number(req.user?.id || 0);
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const jobId = String(req.params.jobId || "").trim();
    if (!jobId) return res.status(400).json({ error: "jobId is required" });

    const st = await fetchDraftJob(jobId);
    if (!st.ok) {
      if (st.status === 404) {
        return res.status(410).json({ error: "Draft job expired. Please generate again." });
      }
      return res.status(st.status || 502).json(st.payload || { error: "Failed to check draft status" });
    }

    const body = st.data;
    if (body.status === "succeeded") {
      const data = body.result || {};
      return res.json({
        ok: true,
        status: "succeeded",
        document_type: data?.document_type || CONTRACT_DRAFT_DOC_TYPE,
        draft: data?.draft || null,
        generation_id: data?.generation_id || null,
        legal_references_used: Array.isArray(data?.legal_references_used)
          ? data.legal_references_used
          : [],
      });
    }
    if (body.status === "failed") {
      return res.status(502).json({ error: body.error || "Draft generation failed" });
    }
    return res.json({ ok: true, status: body.status || "queued" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to check draft status" });
  }
}

export async function regenerateContractAIDraftSectionByAdvocate(req, res) {
  const client = await pool.connect();
  try {

    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const generationId = String(req.body?.generation_id || "").trim();
    const sectionId = String(req.body?.section_id || "").trim();
    const instruction = String(req.body?.instruction || "").trim();
    const language = String(req.body?.language || "English").trim() || "English";
    const currentDraft = req.body?.current_draft;

    if (!generationId || !sectionId || !instruction || !currentDraft) {
      return res.status(400).json({ error: "generation_id, section_id, instruction, current_draft are required" });
    }

    await getAssignedCase(client, caseId, advocateId);

    const upstreamCall = await callDraftingAssistant("/draft/regenerate-section", {
      generation_id: generationId,
      section_id: sectionId,
      instruction,
      case_id: caseId,
      advocate_id: advocateId,
      document_type: CONTRACT_DRAFT_DOC_TYPE,
      language,
      current_draft: currentDraft,
    });

    if (!upstreamCall.ok) return res.status(upstreamCall.status).json(upstreamCall.payload);

    return res.json({
      ok: true,
      section: {
        id: String(upstreamCall.data?.section_id || sectionId),
        heading: String(upstreamCall.data?.heading || ""),
        content: String(upstreamCall.data?.content || ""),
      },
    });
  } catch (err) {
    return res.status(err?.status || 500).json({ error: err.message || "Failed to regenerate section" });
  } finally {
    client.release();
  }
}

export async function saveContractAIDraftByAdvocate(req, res) {
  const client = await pool.connect();
  try {

    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const generationId = String(req.body?.generation_id || "").trim();
    const draft = req.body?.draft;
    if (!generationId || !draft) {
      return res.status(400).json({ error: "generation_id and draft are required" });
    }

    await getAssignedCase(client, caseId, advocateId);

    const upstreamCall = await callDraftingAssistant("/draft/save", {
      case_id: caseId,
      advocate_id: advocateId,
      generation_id: generationId,
      document_type: CONTRACT_DRAFT_DOC_TYPE,
      draft,
    });
    if (!upstreamCall.ok) return res.status(upstreamCall.status).json(upstreamCall.payload);

    return res.json({ ok: true, saved: Boolean(upstreamCall.data?.saved) });
  } catch (err) {
    return res.status(err?.status || 500).json({ error: err.message || "Failed to save draft" });
  } finally {
    client.release();
  }
}

export async function exportContractAIDraftDocxByAdvocate(req, res) {
  const client = await pool.connect();
  try {

    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const draft = req.body?.draft;
    if (!draft) return res.status(400).json({ error: "draft is required" });

    await getAssignedCase(client, caseId, advocateId);

    const draftingBase = getDraftingAssistantBaseUrl();
    if (!draftingBase) return res.status(500).json({ error: "DRAFTING_ASSISTANT_URL is not configured" });

    const url = `${draftingBase.replace(/\/$/, "")}/draft/export`;
    const controller = new AbortController();
    const timeoutMs = getDraftingTimeoutMs();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "*/*",
          "x-internal-key": process.env.INTERNAL_API_KEY || "",
        },
        body: JSON.stringify({
          case_id: caseId,
          document_type: CONTRACT_DRAFT_DOC_TYPE,
          final_draft: draft,
          format: "docx",
        }),
        signal: controller.signal,
      });

      if (!upstream.ok) {
        const data = await upstream.json().catch(() => null);
        return res.status(502).json({ error: data?.detail || data?.error || "DOCX export failed" });
      }

      const buf = Buffer.from(await upstream.arrayBuffer());
      const fileName = `Contract_CASE_${caseId}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
      return res.send(buf);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      return res.status(504).json({ error: "DOCX export timed out" });
    }
    return res.status(err?.status || 500).json({ error: err.message || "Failed to export DOCX" });
  } finally {
    client.release();
  }
}

export async function exportContractAIDraftPdfByAdvocate(req, res) {
  const client = await pool.connect();
  try {

    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const draft = req.body?.draft;
    if (!draft?.title || !Array.isArray(draft?.sections)) {
      return res.status(400).json({ error: "draft with title and sections is required" });
    }

    await getAssignedCase(client, caseId, advocateId);

    const fileName = `Contract_CASE_${caseId}.pdf`;
    const pdf = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
    pdf.pipe(res);

    pdf.fontSize(18).text(String(draft.title), { align: "center" });
    pdf.moveDown(0.5);
    pdf.fontSize(10).fillColor("#666").text(`Case: CASE-${caseId}   Document: Client-Lawyer Contract`, { align: "center" });
    pdf.fillColor("#000");
    pdf.moveDown(1.2);

    for (const sec of draft.sections) {
      pdf.fontSize(13).font("Helvetica-Bold").text(String(sec?.heading || "Section"));
      pdf.moveDown(0.3);
      pdf.fontSize(11).font("Helvetica").text(String(sec?.content || ""), { align: "justify", lineGap: 2 });
      pdf.moveDown(1);
    }

    pdf.end();
  } catch (err) {
    return res.status(err?.status || 500).json({ error: err.message || "Failed to export PDF" });
  } finally {
    client.release();
  }
}
