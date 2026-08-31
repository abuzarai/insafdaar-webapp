// Shared contract read/sign helpers (audit #24 dedup).
// Previously duplicated across client, advocate, and admin contract controllers.

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

export { getLatestContract, getContractSignatures, getContractAttachments,
  logContractEvent, serializeContract, parseSignConfirmations, assertAllSignConfirmations };
