import { GoogleAuth } from "google-auth-library";
import { randomUUID } from "crypto";
import pool from "../db.js";

let cachedIdTokenClient = null;
let conversationsTableReady = false;
let guestUsageTableReady = false;

function toBoolean(value, fallback = false) {
  if (value == null) return fallback;
  return String(value).toLowerCase() === "true";
}

function getRagBaseUrl() {
  return process.env.LEGAL_RAG_API_URL || "";
}

function getGuestPromptLimit() {
  const raw = Number(process.env.LEGAL_ASSISTANT_GUEST_PROMPT_LIMIT || 3);
  if (!Number.isFinite(raw) || raw < 0) return 3;
  return Math.floor(raw);
}

function isLoggedInUser(req) {
  return Boolean(req.user?.id);
}

function getOwnerId(req) {
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }

  const ownerId = req.headers["x-chat-owner-id"];
  if (!ownerId || !String(ownerId).trim()) {
    return null;
  }
  return String(ownerId).trim().slice(0, 128);
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((msg) => ({
      id: String(msg?.id || randomUUID()),
      role: msg?.role === "assistant" ? "assistant" : "user",
      content: String(msg?.content || "").trim(),
      citations: Array.isArray(msg?.citations)
        ? msg.citations
            .map((item) => String(item || "").trim())
            .filter(Boolean)
            .slice(0, 12)
        : [],
      sources: Array.isArray(msg?.sources)
        ? msg.sources
            .map((item) => ({
              title: String(item?.title || "").trim(),
              link: item?.link ? String(item.link).trim() : null,
            }))
            .filter((item) => item.title)
            .slice(0, 8)
        : [],
    }))
    .filter((msg) => msg.content.length > 0);
}

function deriveTitle(messages, fallback = "New Conversation") {
  const firstUser = messages.find((msg) => msg.role === "user");
  if (!firstUser) return fallback;
  return firstUser.content.slice(0, 60).trim() || fallback;
}

async function ensureConversationsTable() {
  if (conversationsTableReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS legal_assistant_conversations (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_legal_assistant_conversations_owner_updated
    ON legal_assistant_conversations (owner_id, updated_at DESC)
  `);

  conversationsTableReady = true;
}

async function ensureGuestUsageTable() {
  if (guestUsageTableReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS legal_assistant_guest_usage (
      owner_id TEXT PRIMARY KEY,
      prompt_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  guestUsageTableReady = true;
}

async function getGuestPromptCount(ownerId) {
  await ensureGuestUsageTable();
  const result = await pool.query(
    `SELECT prompt_count FROM legal_assistant_guest_usage WHERE owner_id = $1`,
    [ownerId]
  );
  if (result.rows.length === 0) return 0;
  return Number(result.rows[0].prompt_count) || 0;
}

async function incrementGuestPromptCount(ownerId) {
  await ensureGuestUsageTable();
  await pool.query(
    `
      INSERT INTO legal_assistant_guest_usage (owner_id, prompt_count, updated_at)
      VALUES ($1, 1, NOW())
      ON CONFLICT (owner_id)
      DO UPDATE SET prompt_count = legal_assistant_guest_usage.prompt_count + 1,
                    updated_at = NOW()
    `,
    [ownerId]
  );
}

function getTimeoutMs() {
  const raw = Number(process.env.LEGAL_RAG_TIMEOUT_MS || 45000);
  if (!Number.isFinite(raw) || raw <= 0) return 45000;
  return raw;
}

async function getAuthHeaders(baseUrl) {
  const requireAuth = toBoolean(process.env.LEGAL_RAG_REQUIRE_AUTH, true);
  if (!requireAuth) return {};

  const audience = process.env.LEGAL_RAG_AUDIENCE || baseUrl;
  if (!cachedIdTokenClient) {
    const auth = new GoogleAuth();
    cachedIdTokenClient = await auth.getIdTokenClient(audience);
  }

  return cachedIdTokenClient.getRequestHeaders();
}

export async function queryLegalAssistant(req, res) {
  try {
    const { query, k = 5 } = req.body || {};

    if (!query || !String(query).trim()) {
      return res.status(400).json({ error: "query is required" });
    }

    const ragBaseUrl = getRagBaseUrl();
    if (!ragBaseUrl) {
      return res.status(500).json({ error: "LEGAL_RAG_API_URL is not configured" });
    }

    if (!isLoggedInUser(req)) {
      const ownerId = getOwnerId(req);
      if (!ownerId) {
        return res.status(400).json({
          error: "x-chat-owner-id header is required for guest chat",
        });
      }

      const guestPromptLimit = getGuestPromptLimit();
      const promptCount = await getGuestPromptCount(ownerId);
      if (promptCount >= guestPromptLimit) {
        return res.status(403).json({
          error: "Guest prompt limit reached. Please login to continue.",
          code: "GUEST_LIMIT_REACHED",
          guestPromptLimit,
        });
      }
    }

    const topK = Math.max(1, Math.min(Number(k) || 5, 10));
    const url = new URL("/query", ragBaseUrl);
    url.searchParams.set("q", String(query).trim());
    url.searchParams.set("k", String(topK));

    const authHeaders = await getAuthHeaders(ragBaseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

    let upstream;
    try {
      upstream = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...authHeaders,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      return res.status(502).json({
        error: payload?.detail || payload?.error || "RAG upstream request failed",
      });
    }

    if (!isLoggedInUser(req)) {
      const ownerId = getOwnerId(req);
      if (ownerId) {
        await incrementGuestPromptCount(ownerId);
      }
    }

    return res.json({
      query: payload?.query || String(query).trim(),
      mode: payload?.mode || "legal",
      answer: payload?.answer || "No answer available.",
      summary: payload?.summary || "",
      analysis: payload?.analysis || "",
      citations: Array.isArray(payload?.citations) ? payload.citations : [],
      sources: Array.isArray(payload?.sources) ? payload.sources : [],
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      return res.status(504).json({ error: "RAG request timed out" });
    }

    return res.status(500).json({
      error: err?.message || "Failed to query legal assistant",
    });
  }
}

export async function listConversations(req, res) {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      return res.status(400).json({ error: "x-chat-owner-id header is required" });
    }

    await ensureConversationsTable();

    const result = await pool.query(
      `
        SELECT id, title, created_at, updated_at
        FROM legal_assistant_conversations
        WHERE owner_id = $1
        ORDER BY updated_at DESC
        LIMIT 100
      `,
      [ownerId]
    );

    return res.json(
      result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
    );
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to list conversations" });
  }
}

export async function getConversation(req, res) {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      return res.status(400).json({ error: "x-chat-owner-id header is required" });
    }

    await ensureConversationsTable();

    const result = await pool.query(
      `
        SELECT id, title, messages, created_at, updated_at
        FROM legal_assistant_conversations
        WHERE id = $1 AND owner_id = $2
      `,
      [req.params.id, ownerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const row = result.rows[0];
    return res.json({
      id: row.id,
      title: row.title,
      messages: row.messages || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to load conversation" });
  }
}

export async function createConversation(req, res) {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      return res.status(400).json({ error: "x-chat-owner-id header is required" });
    }

    await ensureConversationsTable();

    const messages = sanitizeMessages(req.body?.messages);
    const title = String(req.body?.title || deriveTitle(messages)).slice(0, 120).trim() || "New Conversation";
    const id = randomUUID();

    const result = await pool.query(
      `
        INSERT INTO legal_assistant_conversations (id, owner_id, title, messages)
        VALUES ($1, $2, $3, $4::jsonb)
        RETURNING id, title, messages, created_at, updated_at
      `,
      [id, ownerId, title, JSON.stringify(messages)]
    );

    const row = result.rows[0];
    return res.status(201).json({
      id: row.id,
      title: row.title,
      messages: row.messages || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to create conversation" });
  }
}

export async function updateConversation(req, res) {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      return res.status(400).json({ error: "x-chat-owner-id header is required" });
    }

    await ensureConversationsTable();

    const messages = sanitizeMessages(req.body?.messages);
    const title = deriveTitle(messages);

    const result = await pool.query(
      `
        UPDATE legal_assistant_conversations
        SET messages = $3::jsonb,
            title = COALESCE(NULLIF($4, ''), title),
            updated_at = NOW()
        WHERE id = $1 AND owner_id = $2
        RETURNING id, title, messages, created_at, updated_at
      `,
      [req.params.id, ownerId, JSON.stringify(messages), title]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const row = result.rows[0];
    return res.json({
      id: row.id,
      title: row.title,
      messages: row.messages || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to update conversation" });
  }
}

export async function deleteConversation(req, res) {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      return res.status(400).json({ error: "x-chat-owner-id header is required" });
    }

    await ensureConversationsTable();

    const result = await pool.query(
      `
        DELETE FROM legal_assistant_conversations
        WHERE id = $1 AND owner_id = $2
        RETURNING id
      `,
      [req.params.id, ownerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    return res.json({ message: "Conversation deleted" });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to delete conversation" });
  }
}

export async function clearConversations(req, res) {
  try {
    const ownerId = getOwnerId(req);
    if (!ownerId) {
      return res.status(400).json({ error: "x-chat-owner-id header is required" });
    }

    await ensureConversationsTable();

    const result = await pool.query(
      `
        DELETE FROM legal_assistant_conversations
        WHERE owner_id = $1
      `,
      [ownerId]
    );

    return res.json({ message: "Conversations cleared", deleted: result.rowCount || 0 });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to clear conversations" });
  }
}
