import pool from "../../../db.js";
import { CASE_STATUS, transitionCaseStatus } from "../../../utils/caseLifecycle.js";
import { notifyClient, notifyAdvocate } from "../../../utils/notify.js";

async function getCaseForUpdate(client, caseId) {
  const r = await client.query(
    `
      SELECT id, status, user_id, assigned_advocate_id
      FROM public.client_cases
      WHERE id = $1
      FOR UPDATE
    `,
    [Number(caseId)]
  );
  return r.rows[0] || null;
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
             contract_version_no, canonical_text_sha256_at_sign,
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

async function getContractArtifact(client, contractId, versionNo) {
  const r = await client.query(
    `
      SELECT id, canonical_text_sha256, snapshot_json, generated_at
      FROM public.case_contract_artifacts
      WHERE contract_id = $1 AND version_no = $2
      LIMIT 1
    `,
    [Number(contractId), Number(versionNo)]
  );
  return r.rows[0] || null;
}

async function logContractEvent(client, payload) {
  const { contractId, caseId, eventType, actorUserId = null, actorRole = null, details = {} } = payload || {};
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

function serializeContract(contract, signatures, attachments = [], artifact = null) {
  return {
    id: contract.id,
    caseId: contract.case_id,
    versionNo: contract.version_no,
    title: contract.title,
    contractText: contract.contract_text,
    status: contract.status,
    draftedBy: contract.drafted_by,
    updatedBy: contract.updated_by,
    createdAt: contract.created_at,
    updatedAt: contract.updated_at,
    approvedBy: contract.approved_by,
    approvedAt: contract.approved_at,
    approvalNote: contract.approval_note,
    rejectionNote: contract.rejection_note,
    signatures,
    attachments,
    artifact,
  };
}

export async function adminListContractsPendingApproval(req, res) {
  try {
    const r = await pool.query(
      `
        SELECT
          c.id,
          c.case_id,
          c.version_no,
          c.title,
          c.status,
          c.updated_at,
          cc.title AS case_title,
          cu.name AS client_name,
          au.name AS advocate_name
        FROM public.case_contracts c
        JOIN public.client_cases cc ON cc.id = c.case_id
        LEFT JOIN public.users cu ON cu.id = cc.user_id
        LEFT JOIN public.users au ON au.id = cc.assigned_advocate_id
        WHERE c.status = 'PENDING_ADMIN_APPROVAL'
        ORDER BY c.updated_at DESC
      `
    );

    return res.json({ contracts: r.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to list contracts" });
  }
}

export async function adminGetCaseContract(req, res) {
  const client = await pool.connect();
  try {
    const caseId = Number(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const caseRow = await client.query(`SELECT id FROM public.client_cases WHERE id = $1`, [caseId]);
    if (!caseRow.rowCount) return res.status(404).json({ error: "Case not found" });

    const contract = await getLatestContract(client, caseId);
    if (!contract) return res.json({ contract: null });

    const [signatures, attachments, artifact] = await Promise.all([
      getContractSignatures(client, contract.id),
      getContractAttachments(client, contract.id),
      getContractArtifact(client, contract.id, contract.version_no),
    ]);
    return res.json({ contract: serializeContract(contract, signatures, attachments, artifact) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load contract" });
  } finally {
    client.release();
  }
}

export async function adminApproveContract(req, res) {
  const client = await pool.connect();
  try {

    const caseId = Number(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    await client.query("BEGIN");

    const caseRow = await getCaseForUpdate(client, caseId);
    if (!caseRow) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Case not found" });
    }

    const contract = await getLatestContract(client, caseId);
    if (!contract) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contract not found" });
    }

    const signatures = await getContractSignatures(client, contract.id);
    if (!signatures.clientSignature || !signatures.advocateSignature) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Both client and advocate signatures are required" });
    }

    if (!signatures.clientSignature.confirmed_read_understood ||
        !signatures.clientSignature.confirmed_voluntary ||
        !signatures.clientSignature.confirmed_typed_signature ||
        !signatures.clientSignature.confirmed_reviewed_attachments ||
        !signatures.advocateSignature.confirmed_read_understood ||
        !signatures.advocateSignature.confirmed_voluntary ||
        !signatures.advocateSignature.confirmed_typed_signature ||
        !signatures.advocateSignature.confirmed_reviewed_attachments) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Required signature confirmations are missing" });
    }

    const artifact = await getContractArtifact(client, contract.id, contract.version_no);
    if (!artifact || !artifact.canonical_text_sha256) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Signed artifact is missing for this contract version" });
    }

    if (
      Number(signatures.clientSignature.contract_version_no || 0) !== Number(contract.version_no) ||
      Number(signatures.advocateSignature.contract_version_no || 0) !== Number(contract.version_no)
    ) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Signature version mismatch for this contract" });
    }

    if (
      String(signatures.clientSignature.canonical_text_sha256_at_sign || "") !== String(artifact.canonical_text_sha256) ||
      String(signatures.advocateSignature.canonical_text_sha256_at_sign || "") !== String(artifact.canonical_text_sha256)
    ) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Signature evidence hash mismatch" });
    }

    await client.query(
      `
        UPDATE public.case_contracts
        SET status = 'APPROVED',
            updated_by = $2,
            approved_by = $2,
            approved_at = NOW(),
            approval_note = COALESCE($3, approval_note),
            rejection_note = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [contract.id, Number(req.user?.id || 0), req.body?.approvalNote ? String(req.body.approvalNote).trim() : null]
    );

    await transitionCaseStatus(client, {
      caseId,
      toStatus: CASE_STATUS.CASE_ACTIVE,
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || "ADMIN",
      reason: "Admin approved signed contract",
      metadata: { contractId: contract.id },
    });

    await logContractEvent(client, {
      contractId: contract.id,
      caseId,
      eventType: "ADMIN_APPROVED_CONTRACT",
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || "ADMIN",
      details: { action: "approve", versionNo: contract.version_no, artifactId: artifact.id },
    });

    await client.query("COMMIT");

    await Promise.all([
      notifyClient({
        userId: caseRow.user_id,
        title: "Contract Approved - Case Activated",
        message: `Admin approved your contract for case #${caseId}. The case is now active.`,
        type: "CASE",
        priority: "HIGH",
      }).catch(() => {}),
      notifyAdvocate({
        advocateId: caseRow.assigned_advocate_id,
        title: "Contract Approved - Case Activated",
        message: `Admin approved the contract for case #${caseId}. You can now proceed with active case workflow.`,
        type: "CASE",
        priority: "HIGH",
      }).catch(() => {}),
    ]);

    const latest = await getLatestContract(client, caseId);
    const [latestSigs, latestAttachments, latestArtifact] = await Promise.all([
      getContractSignatures(client, latest.id),
      getContractAttachments(client, latest.id),
      getContractArtifact(client, latest.id, latest.version_no),
    ]);
    return res.json({ message: "Contract approved", contract: serializeContract(latest, latestSigs, latestAttachments, latestArtifact) });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(err?.status || 500).json({ error: err.message || "Failed to approve contract" });
  } finally {
    client.release();
  }
}

export async function adminRejectContract(req, res) {
  const client = await pool.connect();
  try {

    const caseId = Number(req.params.caseId);
    const rejectionNote = req.body?.rejectionNote ? String(req.body.rejectionNote).trim() : "Contract changes requested";

    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    await client.query("BEGIN");

    const caseRow = await getCaseForUpdate(client, caseId);
    if (!caseRow) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Case not found" });
    }

    const contract = await getLatestContract(client, caseId);
    if (!contract) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contract not found" });
    }

    await client.query(
      `
        UPDATE public.case_contracts
        SET status = 'DRAFT',
            updated_by = $2,
            approved_by = NULL,
            approved_at = NULL,
            approval_note = NULL,
            rejection_note = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
      [contract.id, Number(req.user?.id || 0), rejectionNote]
    );

    await transitionCaseStatus(client, {
      caseId,
      toStatus: CASE_STATUS.CONTRACT_PENDING_SIGNATURES,
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || "ADMIN",
      reason: "Admin rejected contract",
      metadata: { contractId: contract.id, rejectionNote },
    });

    await logContractEvent(client, {
      contractId: contract.id,
      caseId,
      eventType: "ADMIN_REJECTED_CONTRACT",
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || "ADMIN",
      details: { rejectionNote },
    });

    await client.query("COMMIT");

    await Promise.all([
      notifyClient({
        userId: caseRow.user_id,
        title: "Contract Needs Revision",
        message: `Admin requested changes in your contract for case #${caseId}. Please review and sign again once updated.`,
        type: "CASE",
        priority: "HIGH",
      }).catch(() => {}),
      notifyAdvocate({
        advocateId: caseRow.assigned_advocate_id,
        title: "Contract Sent Back for Revision",
        message: `Admin rejected contract for case #${caseId}. Please revise terms and re-initiate signatures.`,
        type: "CASE",
        priority: "HIGH",
      }).catch(() => {}),
    ]);

    const latest = await getLatestContract(client, caseId);
    const [latestSigs, latestAttachments, latestArtifact] = await Promise.all([
      getContractSignatures(client, latest.id),
      getContractAttachments(client, latest.id),
      getContractArtifact(client, latest.id, latest.version_no),
    ]);
    return res.json({ message: "Contract sent back for revision", contract: serializeContract(latest, latestSigs, latestAttachments, latestArtifact) });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(err?.status || 500).json({ error: err.message || "Failed to reject contract" });
  } finally {
    client.release();
  }
}
