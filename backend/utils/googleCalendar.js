// backend/utils/googleCalendar.js
import crypto from "crypto";
import { google } from "googleapis";

/**
 * Creates a Google Calendar client that impersonates ONE Workspace user.
 * Requires Domain-Wide Delegation enabled for the service account.
 *
 * Scopes: calendar scope is enough for event insert with Meet link.
 */
function getCalendarClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const subject = process.env.GOOGLE_IMPERSONATE_USER_EMAIL;

  if (!clientEmail || !privateKeyRaw || !subject) {
    throw new Error(
      "Missing Google env vars. Need GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, GOOGLE_IMPERSONATE_USER_EMAIL"
    );
  }

  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"],
    subject, // impersonate the single mailbox account
  });

  return google.calendar({ version: "v3", auth });
}

/**
 * Extract best Meet link from event response
 */
function extractMeetLink(event) {
  if (event?.hangoutLink) return event.hangoutLink;

  const eps = event?.conferenceData?.entryPoints || [];
  const video = eps.find((e) => e.entryPointType === "video");
  return video?.uri || null;
}

/**
 * Create calendar event + generate Google Meet link using conferenceData.
 *
 * Calendar API requires conferenceDataVersion=1 to create conferences using createRequest. :contentReference[oaicite:2]{index=2}
 */
export async function createMeetEvent({
  summary,
  description,
  startAt, // Date
  endAt,   // Date
  attendeesEmails = [], // ["a@x.com", "b@y.com"]
  timeZone = "Asia/Karachi",
  sendUpdates = "all", // "all" | "externalOnly" | "none"
  calendarId = process.env.GOOGLE_CALENDAR_ID || "primary",
}) {
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
    throw new Error("createMeetEvent: startAt must be a valid Date");
  }
  if (!(endAt instanceof Date) || Number.isNaN(endAt.getTime())) {
    throw new Error("createMeetEvent: endAt must be a valid Date");
  }
  if (endAt <= startAt) {
    throw new Error("createMeetEvent: endAt must be after startAt");
  }

  const calendar = getCalendarClient();

  // must be unique-ish per request to avoid “duplicate conference” issues
  const requestId = crypto.randomBytes(16).toString("hex");

  const eventBody = {
    summary: summary || "Case Meeting",
    description: description || "",
    start: {
      dateTime: startAt.toISOString(),
      timeZone,
    },
    end: {
      dateTime: endAt.toISOString(),
      timeZone,
    },
    attendees: attendeesEmails
      .filter(Boolean)
      .map((email) => ({ email: String(email).trim() })),

    // ✅ 24h email reminder via calendar (Google may also apply defaults)
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 24 * 60 },
        { method: "popup", minutes: 30 },
      ],
    },

    // ✅ Ask Calendar to generate a Google Meet link
    conferenceData: {
      createRequest: {
        requestId,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  const resp = await calendar.events.insert({
    calendarId,
    conferenceDataVersion: 1, // required to create Meet conferenceData :contentReference[oaicite:3]{index=3}
    sendUpdates,
    requestBody: eventBody,
  });

  const event = resp?.data;

  return {
    googleEventId: event?.id || null,
    htmlLink: event?.htmlLink || null,
    meetLink: extractMeetLink(event),
    raw: event, // keep if you want debug
  };
}
