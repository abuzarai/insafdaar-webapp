const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Submit a background draft-generation job, then poll its status with short
 * requests until it finishes. Long generation (90-180s) is spread across many
 * small requests instead of one long-lived one, so nothing times out and the
 * UI is never left hanging.
 */
export async function submitDraftJobAndPoll(params: {
  submitUrl: string;
  body: unknown;
  statusUrlFor: (jobId: string) => string;
  headers: Headers;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<any> {
  const {
    submitUrl,
    body,
    statusUrlFor,
    headers,
    timeoutMs = 300000,
    pollMs = 2500,
  } = params;

  const res = await fetch(submitUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const queued = await res.json().catch(() => null);
  if (!res.ok) throw new Error(queued?.error || "Failed to start AI draft generation.");
  const jobId = queued?.job_id;
  if (!jobId) throw new Error("Drafting did not return a job id.");

  const deadline = Date.now() + timeoutMs;
  let status: any = null;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const st = await fetch(statusUrlFor(jobId), { headers });
    status = await st.json().catch(() => null);
    if (!st.ok) throw new Error(status?.error || "Failed to check draft status.");
    if (status.status === "succeeded") return status;
    if (status.status === "failed") throw new Error(status?.error || "Draft generation failed.");
  }
  throw new Error("Draft generation timed out. Please try again.");
}