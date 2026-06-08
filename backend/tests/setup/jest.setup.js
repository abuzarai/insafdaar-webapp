process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.LEGAL_RAG_REQUIRE_AUTH = "false";
process.env.LEGAL_RAG_TIMEOUT_MS = "500";
process.env.LEGAL_RAG_API_URL = process.env.LEGAL_RAG_API_URL || "https://mock-rag.insafdaar.test";
process.env.LEGAL_ASSISTANT_GUEST_PROMPT_LIMIT = process.env.LEGAL_ASSISTANT_GUEST_PROMPT_LIMIT || "3";
