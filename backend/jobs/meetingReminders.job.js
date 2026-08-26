import cron from "node-cron";
import pool from "../db.js";
import { sendNotificationEmail } from "../utils/mailer.js";

/**
 * Finds approved meetings inside reminder windows and emails client + advocate.
 * Marks reminder flags to avoid duplicate emails.
 */
async function processReminderWindow({
  label,
  flagColumn, // reminder_24h_sent OR reminder_6h_sent
  windowStartSql, // e.g. NOW() + INTERVAL '23 hours'
  windowEndSql,   // e.g. NOW() + INTERVAL '24 hours'
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock meetings so multiple cron runs don't double-send
    const q = `
      SELECT
        m.id AS meeting_id,
        m.case_id,
        m.start_at,
        m.end_at,
        m.agenda,
        m.google_meet_link,
        c.title AS case_title,

        cu.name AS client_name,
        cu.email AS client_email,

        au.name AS advocate_name,
        au.email AS advocate_email
      FROM public.case_meetings m
      JOIN public.client_cases c ON c.id = m.case_id
      JOIN public.users cu ON cu.id = m.client_user_id
      JOIN public.users au ON au.id = m.advocate_id
      WHERE m.status = 'APPROVED'
        AND m.google_meet_link IS NOT NULL
        AND COALESCE(m.${flagColumn}, FALSE) = FALSE
        AND m.start_at BETWEEN (${windowStartSql}) AND (${windowEndSql})
      FOR UPDATE SKIP LOCKED
    `;

    const r = await client.query(q);

    if (!r.rowCount) {
      await client.query("COMMIT");
      return { sent: 0 };
    }

    let sentCount = 0;

    for (const row of r.rows) {
      const meetingId = row.meeting_id;

      // Prepare email content
      const startStr = new Date(row.start_at).toLocaleString("en-GB", { timeZone: "Asia/Karachi" });
      const endStr = new Date(row.end_at).toLocaleString("en-GB", { timeZone: "Asia/Karachi" });

      const subject = `⏰ Meeting Reminder (${label}) | Case #${row.case_id}`;

      const commonHtml = `
        <p><b>Case:</b> #${row.case_id}${row.case_title ? ` — ${row.case_title}` : ""}</p>
        <p><b>Start (PKT):</b> ${startStr}</p>
        <p><b>End (PKT):</b> ${endStr}</p>
        <p><b>Meet Link:</b> <a href="${row.google_meet_link}" target="_blank" rel="noreferrer">${row.google_meet_link}</a></p>
        ${row.agenda ? `<p><b>Agenda:</b> ${row.agenda}</p>` : ""}
      `;

      // Send emails (best effort)
      const tasks = [];

      if (row.client_email) {
        tasks.push(
          sendNotificationEmail({
            to: row.client_email,
            subject,
            title: `Meeting Reminder (${label})`,
            message: `
              <p>Hi ${row.client_name || "Client"},</p>
              <p>This is a reminder for your upcoming meeting.</p>
              ${commonHtml}
              <p>Please join on time.</p>
            `,
          }).catch(() => {})
        );
      }

      if (row.advocate_email) {
        tasks.push(
          sendNotificationEmail({
            to: row.advocate_email,
            subject,
            title: `Meeting Reminder (${label})`,
            message: `
              <p>Hi ${row.advocate_name || "Advocate"},</p>
              <p>This is a reminder for your upcoming meeting.</p>
              ${commonHtml}
              <p>Please join on time.</p>
            `,
          }).catch(() => {})
        );
      }

      await Promise.all(tasks);

      // Mark flag as sent (IMPORTANT)
      await client.query(
        `
        UPDATE public.case_meetings
        SET ${flagColumn} = TRUE,
            updated_at = NOW()
        WHERE id = $1
        `,
        [meetingId]
      );

      sentCount += 1;
    }

    await client.query("COMMIT");
    return { sent: sentCount };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error(`[CRON] ${label} reminder error:`, e);
    return { sent: 0, error: e };
  } finally {
    client.release();
  }
}

export function startMeetingRemindersJob() {
  // Every 10 minutes
  cron.schedule("*/10 * * * *", async () => {
    try {
      console.log("[CRON] Meeting reminder check...");

      // 24h reminder window: 24h -> 23h (gives 1 hour tolerance)
      const r24 = await processReminderWindow({
        label: "24h",
        flagColumn: "reminder_24h_sent",
        windowStartSql: "NOW() + INTERVAL '23 hours'",
        windowEndSql: "NOW() + INTERVAL '24 hours'",
      });

      // 6h reminder window: 6h -> 5h
      const r6 = await processReminderWindow({
        label: "6h",
        flagColumn: "reminder_6h_sent",
        windowStartSql: "NOW() + INTERVAL '5 hours'",
        windowEndSql: "NOW() + INTERVAL '6 hours'",
      });

      if (r24?.sent) console.log(`[CRON] Sent ${r24.sent} (24h) reminder(s)`);
      if (r6?.sent) console.log(`[CRON] Sent ${r6.sent} (6h) reminder(s)`);
    } catch (e) {
      console.error("[CRON] Meeting reminder job crashed:", e);
    }
  });
}
