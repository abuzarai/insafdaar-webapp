import pool from "../db.js";
import { sendNotificationEmail } from "./mailer.js";

export async function notifyClient({
  userId,
  title,
  message,
  type = "BILLING",
  priority = "HIGH",
}) {
  // dashboard notification for client
  await pool.query(
    `
    INSERT INTO public.client_notifications
      (user_id, title, description, type, priority, is_read, created_at)
    VALUES ($1,$2,$3,$4,$5,false,NOW())
    `,
    [userId, title, message || "", type, priority]
  );

  // email to client (best effort)
  const r = await pool.query(`SELECT email FROM public.users WHERE id=$1`, [userId]);
  const email = r.rows?.[0]?.email;

  if (email) {
    await sendNotificationEmail({
      to: email,
      subject: title,
      title,
      message: message || title,
    }).catch(() => {});
  }
}

// ✅ NEW: notify advocate (email + optional DB notification if you have a table)
export async function notifyAdvocate({
  advocateId,
  title,
  message,
  type = "CASE",
  priority = "HIGH",
}) {
  // OPTIONAL: if you have advocate_notifications table, enable this.
  // If you don't have it, remove this block safely.
  try {
    await pool.query(
      `
      INSERT INTO public.advocate_notifications
        (advocate_id, title, description, type, priority, is_read, created_at)
      VALUES ($1,$2,$3,$4,$5,false,NOW())
      `,
      [advocateId, title, message || "", type, priority]
    );
  } catch {
    // table might not exist — ignore
  }

  // email to advocate (best effort)
  const r = await pool.query(`SELECT email FROM public.users WHERE id=$1`, [advocateId]);
  const email = r.rows?.[0]?.email;

  if (email) {
    await sendNotificationEmail({
      to: email,
      subject: title,
      title,
      message: message || title,
    }).catch(() => {});
  }
}

// ✅ NEW: call this when advocate is assigned
export async function notifyClientAndAdvocateAssigned({
  clientId,
  advocateId,
  caseId,
  clientName,
  advocateName,
}) {
  const clientTitle = "✅ Advocate Assigned to Your Case";
  const clientMsg = `
    <p>Your case <b>#${caseId}</b> has been assigned to an advocate.</p>
    <p><b>Advocate:</b> ${advocateName || "Assigned Advocate"}</p>
    <p>They will contact you shortly. You can also view updates in your dashboard.</p>
  `;

  const advocateTitle = "📌 New Case Assigned";
  const advocateMsg = `
    <p>A new case has been assigned to you.</p>
    <p><b>Case:</b> #${caseId}</p>
    <p><b>Client:</b> ${clientName || "Client"}</p>
    <p>Please review the case details and contact the client.</p>
  `;

  await Promise.all([
    notifyClient({
      userId: clientId,
      title: clientTitle,
      message: clientMsg,
      type: "CASE",
      priority: "HIGH",
    }),
    notifyAdvocate({
      advocateId,
      title: advocateTitle,
      message: advocateMsg,
      type: "CASE",
      priority: "HIGH",
    }),
  ]);
}

export async function notifyAllAdmins({ title, message, type = "BILLING" }) {
  const admins = await pool.query(`SELECT id, email FROM public.users WHERE UPPER(role)='ADMIN'`);

  for (const a of admins.rows) {
    await pool.query(
      `
      INSERT INTO public.admin_notifications
        (admin_id, title, description, type, is_read, created_at)
      VALUES ($1,$2,$3,$4,false,NOW())
      `,
      [a.id, title, message || "", type]
    );

    if (a.email) {
      await sendNotificationEmail({
        to: a.email,
        subject: title,
        title,
        message: message || title,
      }).catch(() => {});
    }
  }
}
