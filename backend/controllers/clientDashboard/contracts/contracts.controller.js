import pool from "../../../db.js";
import { CASE_STATUS, transitionCaseStatus } from "../../../utils/caseLifecycle.js";
import { notifyAdvocate, notifyAllAdmins } from "../../../utils/notify.js";
import {
  buildOtpSessionToken,
  generateOtpCode,
  getOtpConfig,
  hashCanonicalText,
  hashOtp,
  verifyOtpSessionToken,
} from "../../../utils/contractSigning.js";
import { sendContractSigningOtpEmail } from "../../../utils/mailer.js";

let contractTablesReady = false;

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

async function getAccessibleCase(client, caseId, user) {
  const role = String(user?.role || "").toUpperCase();
  const userId = Number(user?.id || 0);

  const result = await client.query(
    `
      SELECT id, user_id, assigned_advocate_id, status
      FROM public.client_cases
      WHERE id = $1
    `,
    [Number(caseId)]
  );

  const row = result.rows[0];
  if (!row) {
    const err = new Error("Case not found");
    err.status = 404;
    throw err;
  }

  if (role === "ADMIN") return row;
  if (role === "CLIENT" && Number(row.user_id) === userId) return row;
  if (role === "ADVOCATE" && Number(row.assigned_advocate_id) === userId) return row;

  const err = new Error("Forbidden");
  err.status = 403;
  throw err;
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
  const s = await client.query(
    `
      SELECT signer_role, signer_user_id, typed_full_name, consent_checked, signature_note, signed_at,
             confirmed_read_understood, confirmed_voluntary, confirmed_typed_signature, confirmed_reviewed_attachments
      FROM public.case_contract_signatures
      WHERE contract_id = $1
    `,
    [Number(contractId)]
  );

  let clientSig = null;
  let advocateSig = null;
  for (const row of s.rows) {
    const role = String(row.signer_role || "").toUpperCase();
    if (role === "CLIENT") clientSig = row;
    if (role === "ADVOCATE") advocateSig = row;
  }

  return { clientSignature: clientSig, advocateSignature: advocateSig };
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

async function logContractEvent(client, options) {
  const {
    contractId,
    caseId,
    eventType,
    actorUserId = null,
    actorRole = null,
    details = {},
  } = options || {};

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

export async function getCaseContract(req, res) {
  const client = await pool.connect();
  try {
    await ensureContractTables();

    const caseId = Number(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    await getAccessibleCase(client, caseId, req.user);

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

export async function requestContractSigningOtpByClient(req, res) {
  const client = await pool.connect();
  try {
    await ensureContractTables();

    const role = String(req.user?.role || "").toUpperCase();
    if (role !== "CLIENT") return res.status(403).json({ error: "Forbidden" });

    const caseId = Number(req.params.caseId);
    const userId = Number(req.user?.id || 0);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    await client.query("BEGIN");

    await getAccessibleCase(client, caseId, req.user);
    const contract = await getLatestContract(client, caseId);
    if (!contract) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contract not found" });
    }

    const userR = await client.query(`SELECT email FROM public.users WHERE id = $1`, [userId]);
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
        VALUES ($1, $2, $3, $4, 'CLIENT', 'CONTRACT_SIGN', $5, NOW() + ($6::text || ' minutes')::interval, $7)
        RETURNING id, expires_at
      `,
      [contract.id, caseId, contract.version_no, userId, otpHash, String(config.ttlMinutes), config.maxAttempts]
    );

    await logContractEvent(client, {
      contractId: contract.id,
      caseId,
      eventType: "OTP_REQUESTED_BY_CLIENT",
      actorUserId: userId,
      actorRole: req.user?.role || "CLIENT",
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

export async function verifyContractSigningOtpByClient(req, res) {
  const client = await pool.connect();
  try {
    await ensureContractTables();

    const role = String(req.user?.role || "").toUpperCase();
    if (role !== "CLIENT") return res.status(403).json({ error: "Forbidden" });

    const userId = Number(req.user?.id || 0);
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
          AND signer_role = 'CLIENT'
          AND purpose = 'CONTRACT_SIGN'
        FOR UPDATE
      `,
      [otpRequestId, userId]
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
      eventType: "OTP_VERIFIED_BY_CLIENT",
      actorUserId: userId,
      actorRole: req.user?.role || "CLIENT",
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

export async function signCaseContractByClient(req, res) {
  const client = await pool.connect();
  try {
    await ensureContractTables();

    const role = String(req.user?.role || "").toUpperCase();
    if (role !== "CLIENT") return res.status(403).json({ error: "Forbidden" });

    const caseId = Number(req.params.caseId);
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

    const caseRow = await getAccessibleCase(client, caseId, req.user);
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
      Number(otpPayload.signerUserId) !== Number(req.user.id) ||
      String(otpPayload.signerRole || "").toUpperCase() !== "CLIENT" ||
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
        VALUES ($1, $2, $3, 'CLIENT', $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14, $15, NOW())
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
        Number(req.user.id),
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
        [contract.id, Number(req.user.id)]
      );

      await transitionCaseStatus(client, {
        caseId,
        toStatus: CASE_STATUS.CONTRACT_PENDING_ADMIN_APPROVAL,
        actorUserId: req.user.id,
        actorRole: req.user.role,
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
        [contract.id, Number(req.user.id)]
      );

      if (String(caseRow.status || "").toUpperCase() !== CASE_STATUS.CONTRACT_PENDING_SIGNATURES) {
        await transitionCaseStatus(client, {
          caseId,
          toStatus: CASE_STATUS.CONTRACT_PENDING_SIGNATURES,
          actorUserId: req.user.id,
          actorRole: req.user.role,
          reason: "Contract signing started",
          metadata: { contractId: contract.id, versionNo: contract.version_no },
        });
      }
    }

    await logContractEvent(client, {
      contractId: contract.id,
      caseId,
      eventType: "CLIENT_SIGNED",
      actorUserId: req.user.id,
      actorRole: req.user.role,
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
      await notifyAdvocate({
        advocateId: caseRow.assigned_advocate_id,
        title: "Client Signed the Contract",
        message: `Client signed contract v${contract.version_no} for case #${caseId}. Please sign to move it to admin approval.`,
        type: "CASE",
        priority: "HIGH",
      }).catch(() => {});
    }

    const latest = await getLatestContract(client, caseId);
    const [latestSigs, latestAttachments] = await Promise.all([
      getContractSignatures(client, latest.id),
      getContractAttachments(client, latest.id),
    ]);
    return res.json({
      message: "Contract signed successfully",
      contract: serializeContract(latest, latestSigs, latestAttachments),
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(err?.status || 500).json({ error: err.message || "Failed to sign contract" });
  } finally {
    client.release();
  }
}
