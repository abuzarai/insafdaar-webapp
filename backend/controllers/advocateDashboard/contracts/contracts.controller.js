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

const CONTRACT_DRAFT_DOC_TYPE = "Client-Lawyer Contract";

const CONTRACT_UPLOAD_DIR = path.resolve("uploads/contracts");
fs.mkdirSync(CONTRACT_UPLOAD_DIR, { recursive: true });

let contractTablesReady = false;

function getDraftingAssistantBaseUrl() {
  return String(process.env.DRAFTING_ASSISTANT_URL || "").trim();
}

function getDraftingTimeoutMs() {
  const timeoutMs = Number(process.env.DRAFTING_ASSISTANT_TIMEOUT_MS || 45000);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45000;
}

function getDraftingGenerateTimeoutMs() {
  const timeoutMs = Number(process.env.DRAFTING_ASSISTANT_GENERATE_TIMEOUT_MS || getDraftingTimeoutMs());
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : getDraftingTimeoutMs();
}

async function callDraftingAssistant(pathname, payload, timeoutMs = getDraftingTimeoutMs()) {
  const draftingBase = getDraftingAssistantBaseUrl();
  if (!draftingBase) {
    return { ok: false, status: 500, payload: { error: "DRAFTING_ASSISTANT_URL is not configured" } };
  }

  const url = `${draftingBase.replace(/\/$/, "")}${pathname}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-internal-key": process.env.INTERNAL_API_KEY || "",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return {
        ok: false,
        status: 502,
        payload: { error: data?.detail || data?.error || "Drafting assistant request failed" },
      };
    }

    return { ok: true, data };
  } catch (err) {
    if (err?.name === "AbortError") {
      return { ok: false, status: 504, payload: { error: `Drafting assistant request timed out after ${timeoutMs}ms` } };
    }
    if (err?.cause?.code === "ECONNREFUSED" || err?.cause?.code === "ENOTFOUND") {
      return {
        ok: false,
        status: 502,
        retryable: true,
        payload: { error: "Drafting assistant is unreachable" },
      };
    }
    return { ok: false, status: 500, payload: { error: "Internal server error" } };
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureContractTables() {
  if (contractTablesReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.case_contracts (
      id BIGSERIAL PRIMARY KEY,
      case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL DEFAULT 1,
      title TEXT,
      contract_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      drafted_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_by INTEGER REFERENCES public.users(id),
      approved_at TIMESTAMPTZ,
      approval_note TEXT,
      rejection_note TEXT,
      UNIQUE (case_id, version_no)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.case_contract_signatures (
      id BIGSERIAL PRIMARY KEY,
      contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
      case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
      signer_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      signer_role TEXT NOT NULL,
      typed_full_name TEXT NOT NULL,
      consent_checked BOOLEAN NOT NULL DEFAULT FALSE,
      signature_note TEXT,
      ip_address TEXT,
      user_agent TEXT,
      contract_version_no INTEGER,
      canonical_text_sha256_at_sign TEXT,
      otp_verified_at TIMESTAMPTZ,
      otp_session_id TEXT,
      confirmed_read_understood BOOLEAN NOT NULL DEFAULT FALSE,
      confirmed_voluntary BOOLEAN NOT NULL DEFAULT FALSE,
      confirmed_typed_signature BOOLEAN NOT NULL DEFAULT FALSE,
      confirmed_reviewed_attachments BOOLEAN NOT NULL DEFAULT FALSE,
      signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (contract_id, signer_role)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.case_contract_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
      case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      actor_user_id INTEGER REFERENCES public.users(id),
      actor_role TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.case_contract_otps (
      id BIGSERIAL PRIMARY KEY,
      contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
      case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL,
      signer_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      signer_role TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'CONTRACT_SIGN',
      otp_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.case_contract_artifacts (
      id BIGSERIAL PRIMARY KEY,
      contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
      case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL,
      canonical_text_sha256 TEXT NOT NULL,
      snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (contract_id, version_no)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.case_contract_attachments (
      id BIGSERIAL PRIMARY KEY,
      contract_id BIGINT NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
      case_id INTEGER NOT NULL REFERENCES public.client_cases(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size BIGINT NOT NULL,
      uploaded_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  contractTablesReady = true;
}

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

async function getLatestContract(client, caseId) {
  const r = await client.query(
    `
      SELECT *
      FROM public.case_contracts
      WHERE case_id = $1
      ORDER BY version_no DESC, id DESC
      LIMIT 1
    `,
    [Number(caseId)]
  );
  return r.rows[0] || null;
}

async function getContractSignatures(client, contractId) {
  const r = await client.query(
    `
      SELECT signer_role, signer_user_id, typed_full_name, consent_checked, signature_note, signed_at,
             confirmed_read_understood, confirmed_voluntary, confirmed_typed_signature, confirmed_reviewed_attachments
      FROM public.case_contract_signatures
      WHERE contract_id = $1
    `,
    [Number(contractId)]
  );

  let clientSignature = null;
  let advocateSignature = null;
  for (const row of r.rows) {
    const role = String(row.signer_role || "").toUpperCase();
    if (role === "CLIENT") clientSignature = row;
    if (role === "ADVOCATE") advocateSignature = row;
  }
  return { clientSignature, advocateSignature };
}

async function getContractAttachments(client, contractId) {
  const r = await client.query(
    `
      SELECT id, file_name, file_path, mime_type, file_size, created_at
      FROM public.case_contract_attachments
      WHERE contract_id = $1
      ORDER BY created_at DESC
    `,
    [Number(contractId)]
  );
  return r.rows;
}

async function logContractEvent(client, payload) {
  const {
    contractId,
    caseId,
    eventType,
    actorUserId = null,
    actorRole = null,
    details = {},
  } = payload || {};

  await client.query(
    `
      INSERT INTO public.case_contract_audit_logs
        (contract_id, case_id, event_type, actor_user_id, actor_role, details)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      Number(contractId),
      Number(caseId),
      String(eventType || "UNKNOWN"),
      actorUserId ? Number(actorUserId) : null,
      actorRole ? String(actorRole) : null,
      JSON.stringify(details || {}),
    ]
  );
}

function serializeContract(contract, signatures, attachments) {
  return {
    id: contract.id,
    caseId: contract.case_id,
    versionNo: contract.version_no,
    title: contract.title,
    contractText: contract.contract_text,
    status: contract.status,
    draftedBy: contract.drafted_by,
    updatedBy: contract.updated_by,
    approvedBy: contract.approved_by,
    approvedAt: contract.approved_at,
    createdAt: contract.created_at,
    updatedAt: contract.updated_at,
    signatures,
    attachments,
  };
}

function parseSignConfirmations(body) {
  return {
    confirmedReadUnderstood: Boolean(body?.confirmedReadUnderstood),
    confirmedVoluntary: Boolean(body?.confirmedVoluntary),
    confirmedTypedSignature: Boolean(body?.confirmedTypedSignature),
    confirmedReviewedAttachments: Boolean(body?.confirmedReviewedAttachments),
  };
}

function assertAllSignConfirmations(confirmations) {
  if (!confirmations.confirmedReadUnderstood) {
    throw new Error("Please confirm you read and understood the contract");
  }
  if (!confirmations.confirmedVoluntary) {
    throw new Error("Please confirm you agree voluntarily");
  }
  if (!confirmations.confirmedTypedSignature) {
    throw new Error("Please confirm typed name as legal signature");
  }
  if (!confirmations.confirmedReviewedAttachments) {
    throw new Error("Please confirm you reviewed all attachments");
  }
}

export async function getCaseContractForAdvocate(req, res) {
  const client = await pool.connect();
  try {
    await ensureContractTables();
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
    await ensureContractTables();

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
    await ensureContractTables();
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
    await ensureContractTables();
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
    await ensureContractTables();
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
    await ensureContractTables();

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
    await ensureContractTables();
    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    await getAssignedCase(client, caseId, advocateId);

    await client.query(
      `
      CREATE TABLE IF NOT EXISTS public.draft_sessions (
        id SERIAL PRIMARY KEY,
        case_id INTEGER NOT NULL,
        document_type TEXT NOT NULL,
        generation_id TEXT UNIQUE NOT NULL,
        draft_json JSONB NOT NULL,
        advocate_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
      )
      `
    );

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
    await ensureContractTables();

    const caseId = Number(req.params.caseId);
    const advocateId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const advocateNotes = String(req.body?.advocate_notes || "").trim();
    const language = String(req.body?.language || "English").trim() || "English";

    await getAssignedCase(client, caseId, advocateId);

    let upstreamCall = await callDraftingAssistant(
      "/draft/generate",
      {
        case_id: caseId,
        advocate_id: advocateId,
        document_type: CONTRACT_DRAFT_DOC_TYPE,
        advocate_notes: advocateNotes,
        language,
      },
      getDraftingGenerateTimeoutMs()
    );

    // Retry only genuine network failures; never on 504 (the drafting service
    // keeps generating server-side — a retry would duplicate the expensive
    // Gemini call and leave two competing generation_ids).
    if (!upstreamCall.ok && upstreamCall.retryable) {
      upstreamCall = await callDraftingAssistant(
        "/draft/generate",
        {
          case_id: caseId,
          advocate_id: advocateId,
          document_type: CONTRACT_DRAFT_DOC_TYPE,
          advocate_notes: advocateNotes,
          language,
        },
        getDraftingGenerateTimeoutMs()
      );
    }

    if (!upstreamCall.ok) return res.status(upstreamCall.status).json(upstreamCall.payload);

    return res.json({
      ok: true,
      document_type: CONTRACT_DRAFT_DOC_TYPE,
      draft: upstreamCall.data?.draft || null,
      generation_id: upstreamCall.data?.generation_id || null,
      legal_references_used: Array.isArray(upstreamCall.data?.legal_references_used)
        ? upstreamCall.data.legal_references_used
        : [],
    });
  } catch (err) {
    return res.status(err?.status || 500).json({ error: err.message || "Failed to generate draft" });
  } finally {
    client.release();
  }
}

export async function regenerateContractAIDraftSectionByAdvocate(req, res) {
  const client = await pool.connect();
  try {
    await ensureContractTables();

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
    await ensureContractTables();

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
    await ensureContractTables();

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
    await ensureContractTables();

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
