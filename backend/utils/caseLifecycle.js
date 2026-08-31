
export const CASE_STATUS = {
  DRAFT: "DRAFT",
  INTAKE_STARTED: "INTAKE_STARTED",
  MATCHING_REVIEW: "MATCHING_REVIEW",
  ADVOCATE_ASSIGNED: "ADVOCATE_ASSIGNED",
  ACCEPTED: "ACCEPTED",
  MEETING_PENDING_ADMIN: "MEETING_PENDING_ADMIN",
  MEETING_APPROVED: "MEETING_APPROVED",
  CONTRACT_PENDING_SIGNATURES: "CONTRACT_PENDING_SIGNATURES",
  CONTRACT_PENDING_ADMIN_APPROVAL: "CONTRACT_PENDING_ADMIN_APPROVAL",
  CASE_ACTIVE: "CASE_ACTIVE",
};

const ALLOWED_TRANSITIONS = {
  DRAFT: ["INTAKE_STARTED", "MATCHING_REVIEW", "ADVOCATE_ASSIGNED"],
  INTAKE_STARTED: ["MATCHING_REVIEW", "ADVOCATE_ASSIGNED"],
  MATCHING_REVIEW: ["ADVOCATE_ASSIGNED"],
  ADVOCATE_ASSIGNED: ["ACCEPTED", "MATCHING_REVIEW"],
  ACCEPTED: ["MEETING_PENDING_ADMIN", "CONTRACT_PENDING_SIGNATURES", "MATCHING_REVIEW"],
  MEETING_PENDING_ADMIN: ["MEETING_APPROVED", "ACCEPTED"],
  MEETING_APPROVED: ["CONTRACT_PENDING_SIGNATURES"],
  CONTRACT_PENDING_SIGNATURES: ["CONTRACT_PENDING_ADMIN_APPROVAL"],
  CONTRACT_PENDING_ADMIN_APPROVAL: ["CASE_ACTIVE", "CONTRACT_PENDING_SIGNATURES"],
  CASE_ACTIVE: [],
};

function normalizeStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function isTransitionAllowed(fromStatus, toStatus) {
  if (!fromStatus) return true;
  if (fromStatus === toStatus) return true;
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, fromStatus)) {
    return true;
  }
  return (ALLOWED_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

export async function getCaseForUpdate(client, caseId) {
  const r = await client.query(
    `
      SELECT id, status, assigned_advocate_id
      FROM public.client_cases
      WHERE id = $1
      FOR UPDATE
    `,
    [Number(caseId)]
  );
  return r.rows[0] || null;
}

export async function transitionCaseStatus(client, options) {
  const {
    caseId,
    toStatus,
    actorUserId = null,
    actorRole = null,
    reason = null,
    metadata = {},
    allowSameStatus = true,
  } = options || {};

  const targetStatus = normalizeStatus(toStatus);
  if (!targetStatus) {
    throw new Error("toStatus is required");
  }

  const caseRow = await getCaseForUpdate(client, caseId);
  if (!caseRow) {
    const err = new Error("Case not found");
    err.status = 404;
    throw err;
  }

  const currentStatus = normalizeStatus(caseRow.status);

  if (currentStatus === targetStatus && !allowSameStatus) {
    const err = new Error("Case already in target status");
    err.status = 409;
    throw err;
  }

  if (!isTransitionAllowed(currentStatus, targetStatus)) {
    const err = new Error(`Invalid status transition: ${currentStatus} -> ${targetStatus}`);
    err.status = 409;
    throw err;
  }

  const updated = await client.query(
    `
      UPDATE public.client_cases
      SET status = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, status, assigned_advocate_id, updated_at
    `,
    [Number(caseId), targetStatus]
  );

  await client.query(
    `
      INSERT INTO public.case_lifecycle_events
        (case_id, from_status, to_status, actor_user_id, actor_role, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      Number(caseId),
      currentStatus || null,
      targetStatus,
      actorUserId ? Number(actorUserId) : null,
      actorRole ? String(actorRole) : null,
      reason ? String(reason) : null,
      JSON.stringify(metadata || {}),
    ]
  );

  return {
    before: caseRow,
    after: updated.rows[0],
  };
}
