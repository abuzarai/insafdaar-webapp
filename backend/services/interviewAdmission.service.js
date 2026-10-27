// Callers holding a case lock always acquire the singleton policy lock second.
export async function allowance(db, actorId, lock = false) {
  const policy = await db.query(`SELECT paused FROM public.interview_admission_policy WHERE singleton=true${lock ? ' FOR UPDATE' : ''}`);
  if (!policy.rows.length) return { canStart: false, reason: 'paused', retryAt: null };
  const { rows: [row] } = await db.query(`WITH moment AS (SELECT clock_timestamp() AS t), charged AS (
    SELECT * FROM public.interview_admissions WHERE outcome<>'refunded'
  ) SELECT
    (SELECT max(active_until) FROM charged,moment WHERE actor_user_id=$1 AND active_until>t) AS ledger_active,
    (SELECT max(expires_at) FROM public.case_intake_live_sessions,moment WHERE actor_user_id=$1 AND expires_at>t) AS binding_active,
    (SELECT count(*)::int FROM charged,moment WHERE actor_user_id=$1 AND created_at>t-INTERVAL '24 hours') AS daily,
    (SELECT min(created_at)+INTERVAL '24 hours' FROM (SELECT created_at FROM charged,moment WHERE actor_user_id=$1 AND created_at>t-INTERVAL '24 hours' ORDER BY created_at DESC OFFSET 1 LIMIT 1) q) AS daily_retry,
    (SELECT count(*)::int FROM charged,moment WHERE actor_user_id=$1 AND created_at>t-INTERVAL '7 days') AS weekly,
    (SELECT min(created_at)+INTERVAL '7 days' FROM (SELECT created_at FROM charged,moment WHERE actor_user_id=$1 AND created_at>t-INTERVAL '7 days' ORDER BY created_at DESC OFFSET 4 LIMIT 1) q) AS weekly_retry,
    (SELECT count(*)::int FROM charged,moment WHERE created_at>t-INTERVAL '24 hours') AS platform,
    (SELECT min(created_at)+INTERVAL '24 hours' FROM (SELECT created_at FROM charged,moment WHERE created_at>t-INTERVAL '24 hours' ORDER BY created_at DESC OFFSET 24 LIMIT 1) q) AS platform_retry`, [actorId]);
  if (policy.rows[0].paused) return { canStart: false, reason: 'paused', retryAt: null };
  const restrictions = [];
  if (row.ledger_active || row.binding_active) restrictions.push({ reason: 'active_interview',
    time: Math.max(...[row.ledger_active, row.binding_active].filter(Boolean).map(value => new Date(value).getTime())) });
  for (const [field, limit, reason] of [['daily',2,'daily_limit'],['weekly',5,'weekly_limit'],['platform',25,'platform_limit']]) {
    if (row[field] >= limit) restrictions.push({ reason, time: new Date(row[`${field}_retry`]).getTime() });
  }
  // Starting becomes possible only after every currently blocking window ends.
  const latest = restrictions.reduce((last, value) => !last || value.time > last.time ? value : last, null);
  return { canStart: !latest, reason: latest?.reason || null, retryAt: latest ? new Date(latest.time).toISOString() : null };
}
export function enforceAllowance(value) {
  if (value.canStart) return;
  const [status, code] = {
    daily_limit: [429,'INTERVIEW_DAILY_LIMIT'], weekly_limit: [429,'INTERVIEW_WEEKLY_LIMIT'],
    platform_limit: [429,'INTERVIEW_PLATFORM_LIMIT'], active_interview: [409,'INTERVIEW_ALREADY_ACTIVE'], paused: [503,'INTERVIEWS_PAUSED'],
  }[value.reason];
  throw Object.assign(new Error(code), { status, code, retryAt: value.retryAt });
}
export async function reserveAdmission(db, actor, c, key, hash, request) {
  enforceAllowance(await allowance(db, actor.id, true));
  const past = await db.query("SELECT 1 FROM public.interview_admissions WHERE case_id=$1 AND actor_user_id=$2 AND outcome<>'refunded' LIMIT 1", [c.id, actor.id]);
  if ((c.selected_intake_revision_id || past.rows.length) && request.newInterview !== true) {
    throw Object.assign(new Error('NEW_INTERVIEW_CONFIRMATION_REQUIRED'), { status: 409, code: 'NEW_INTERVIEW_CONFIRMATION_REQUIRED' });
  }
  // Unknown outcomes outlive the 5s bootstrap timeout plus the original 300s
  // session maximum. Expiring this active lease never refunds the admission.
  await db.query(`INSERT INTO public.interview_admissions(actor_user_id,case_id,intent_key,request_hash,outcome,active_until)
    VALUES ($1,$2,$3,$4,'reserved',clock_timestamp()+INTERVAL '10 minutes')`, [actor.id,c.id,key,hash]);
}
export async function assertCaseInactive(db, c) {
  const found = await db.query(`SELECT 1 FROM public.interview_admissions WHERE case_id=$1 AND outcome<>'refunded' AND active_until>clock_timestamp()
    UNION ALL SELECT 1 FROM public.case_intake_live_sessions WHERE case_id=$1 AND expires_at>clock_timestamp() LIMIT 1`, [c.id]);
  if (found.rows.length) throw Object.assign(new Error('INTERVIEW_ALREADY_ACTIVE'), { status:409, code:'INTERVIEW_ALREADY_ACTIVE' });
}
