// backend/jobs/hearingReminders.job.js
import cron from "node-cron";
import pool from "../db.js";
import { sendNotificationEmail } from "../utils/mailer.js";

/**
 * Court Hearing Reminders
 * Uses: public.case_hearings
 * Flags: reminder_24h_sent, reminder_6h_sent
 *
 * NOTE:
 * - Only SCHEDULED hearings are reminded
 * - Uses FOR UPDATE SKIP LOCKED to prevent double-send in overlapping cron runs
 */

async function processHearingReminderWindow({
  label,
  flagColumn, // reminder_24h_sent OR reminder_6h_sent
  windowStartSql, // e.g. NOW() + INTERVAL '23 hours'
  windowEndSql, // e.g. NOW() + INTERVAL '24 hours'
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const q = `
      SELECT
        h.id AS hearing_id,
        h.case_id,
        h.advocate_id,
        h.hearing_at,
        h.court_name,
        h.courtroom,
        h.purpose,

        c.title AS case_title,

        cu.name  AS client_name,
        cu.email AS client_email,

        au.name  AS advocate_name,
        au.email AS advocate_email
      FROM public.case_hearings h
      JOIN public.client_cases c ON c.id = h.case_id
      JOIN public.users au ON au.id = h.advocate_id
      JOIN public.users cu ON cu.id = c.user_id
      WHERE h.status = 'SCHEDULED'
        AND COALESCE(h.${flagColumn}, FALSE) = FALSE
        AND h.hearing_at BETWEEN (${windowStartSql}) AND (${windowEndSql})
      FOR UPDATE SKIP LOCKED
    `;

    const r = await client.query(q);

    if (!r.rowCount) {
      await client.query("COMMIT");
      return { sent: 0 };
    }

    let sentCount = 0;

    for (const row of r.rows) {
      const hearingId = row.hearing_id;

      const hearingStr = new Date(row.hearing_at).toLocaleString("en-GB", {
        timeZone: "Asia/Karachi",
      });

      const subject = `⚖️ Court Hearing Reminder (${label}) | Case #${row.case_id}`;

      const commonHtml = `
        <p><b>Case:</b> #${row.case_id}${row.case_title ? ` — ${row.case_title}` : ""}</p>
        <p><b>Hearing (PKT):</b> ${hearingStr}</p>
        ${row.court_name ? `<p><b>Court:</b> ${row.court_name}</p>` : ""}
        ${row.courtroom ? `<p><b>Courtroom:</b> ${row.courtroom}</p>` : ""}
        ${row.purpose ? `<p><b>Purpose:</b> ${row.purpose}</p>` : ""}
      `;

      const tasks = [];

      // Client email
      if (row.client_email) {
        tasks.push(
          sendNotificationEmail({
            to: row.client_email,
            subject,
            title: `Court Hearing Reminder (${label})`,
            message: `
              <p>Hi ${row.client_name || "Client"},</p>
              <p>This is a reminder for your upcoming court hearing.</p>
              ${commonHtml}
              <p>Please be prepared and arrive on time.</p>
            `,
          }).catch(() => {})
        );
      }

      // Advocate email
      if (row.advocate_email) {
        tasks.push(
          sendNotificationEmail({
            to: row.advocate_email,
            subject,
            title: `Court Hearing Reminder (${label})`,
            message: `
              <p>Hi ${row.advocate_name || "Advocate"},</p>
              <p>This is a reminder for your upcoming court hearing.</p>
              ${commonHtml}
              <p>Please ensure readiness (attendance, documents, evidence, drafts).</p>
            `,
          }).catch(() => {})
        );
      }

      await Promise.all(tasks);

      // Mark as sent
      await client.query(
        `
        UPDATE public.case_hearings
        SET ${flagColumn} = TRUE,
            updated_at = NOW()
        WHERE id = $1
        `,
        [hearingId]
      );

      sentCount += 1;
    }

    await client.query("COMMIT");
    return { sent: sentCount };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error(`[CRON] hearing ${label} reminder error:`, e);
    return { sent: 0, error: e };
  } finally {
    client.release();
  }
}

export function startCourtHearingRemindersJob() {
  // Every 10 minutes (same as meetings)
  cron.schedule("*/10 * * * *", async () => {
    try {
      console.log("[CRON] Court hearing reminder check...");

      const r24 = await processHearingReminderWindow({
        label: "24h",
        flagColumn: "reminder_24h_sent",
        windowStartSql: "NOW() + INTERVAL '23 hours'",
        windowEndSql: "NOW() + INTERVAL '24 hours'",
      });

      const r6 = await processHearingReminderWindow({
        label: "6h",
        flagColumn: "reminder_6h_sent",
        windowStartSql: "NOW() + INTERVAL '5 hours'",
        windowEndSql: "NOW() + INTERVAL '6 hours'",
      });

      if (r24?.sent) console.log(`[CRON] Sent ${r24.sent} hearing reminder(s) (24h)`);
      if (r6?.sent) console.log(`[CRON] Sent ${r6.sent} hearing reminder(s) (6h)`);
    } catch (e) {
      console.error("[CRON] Hearing reminder job crashed:", e);
    }
  });
}
