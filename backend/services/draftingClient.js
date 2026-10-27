// Drafting-assistant HTTP client (audit #24 dedup).
// Shared by the contract and case-preparation drafting flows.
function getDraftingAssistantBaseUrl() {
  return String(process.env.DRAFTING_ASSISTANT_URL || "").trim();
}

function getDraftingTimeoutMs() {
  const timeoutMs = Number(process.env.DRAFTING_ASSISTANT_TIMEOUT_MS || 45000);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45000;
}

function getDraftingGenerateTimeoutMs() {
  const timeoutMs = Number(process.env.DRAFTING_ASSISTANT_GENERATE_TIMEOUT_MS || getDraftingTimeoutMs());
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : getDraftingTimeoutMs();
}

async function fetchDraftJob(jobId, { caseId, advocateId }, timeoutMs = 20000) {
  if (!Number.isSafeInteger(caseId) || caseId <= 0 ||
      !Number.isSafeInteger(advocateId) || advocateId <= 0) {
    return { ok: false, status: 400, payload: { error: "Valid case and advocate scope is required" } };
  }
  const draftingBase = getDraftingAssistantBaseUrl();
  if (!draftingBase) {
    return { ok: false, status: 500, payload: { error: "DRAFTING_ASSISTANT_URL is not configured" } };
  }
  const scope = new URLSearchParams({ case_id: String(caseId), advocate_id: String(advocateId) });
  const url = `${draftingBase.replace(/\/$/, "")}/draft/generate/${encodeURIComponent(jobId)}?${scope}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-internal-key": process.env.INTERNAL_API_KEY || "",
      },
      signal: controller.signal,
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return {
        ok: false,
        status: upstream.status,
        payload: { error: data?.detail || data?.error || "Drafting assistant request failed" },
      };
    }
    return { ok: true, data };
  } catch (err) {
    if (err?.name === "AbortError") {
      return { ok: false, status: 504, payload: { error: "Drafting assistant request timed out" } };
    }
    return { ok: false, status: 502, payload: { error: "Drafting assistant is unreachable" } };
  } finally {
    clearTimeout(timeout);
  }
}

async function callDraftingAssistant(pathname, payload, asJson = true, timeoutMs = getDraftingTimeoutMs()) {
  const draftingBase = getDraftingAssistantBaseUrl();
  if (!draftingBase) {
    return { ok: false, status: 500, payload: { error: "DRAFTING_ASSISTANT_URL is not configured" } };
  }

  const url = `${draftingBase.replace(/\/$/, "")}${pathname}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: asJson ? "application/json" : "*/*",
        "x-internal-key": process.env.INTERNAL_API_KEY || "",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const data = await upstream.json().catch(() => null);
      return {
        ok: false,
        status: [400, 403, 404, 409, 422].includes(upstream.status) ? upstream.status : 502,
        payload: { error: data?.detail || data?.error || "Drafting assistant request failed" },
      };
    }

    if (!asJson) {
      return { ok: true, upstream };
    }

    const data = await upstream.json().catch(() => null);
    return { ok: true, data };
  } catch (err) {
    if (err?.name === "AbortError") {
      return { ok: false, status: 504, payload: { error: `Drafting assistant request timed out after ${timeoutMs}ms` } };
    }

    if (err?.cause?.code === "ECONNREFUSED" || err?.cause?.code === "ENOTFOUND") {
      return {
        ok: false,
        status: 502,
        retryable: true,
        payload: { error: "Drafting assistant is unreachable" },
      };
    }

    return { ok: false, status: 500, payload: { error: "Internal server error" }, err };
  } finally {
    clearTimeout(timeout);
  }
}

export { getDraftingAssistantBaseUrl, getDraftingTimeoutMs, getDraftingGenerateTimeoutMs,
  fetchDraftJob, callDraftingAssistant };
