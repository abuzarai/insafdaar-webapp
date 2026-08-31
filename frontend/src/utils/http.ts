import axios from "axios";

// Slow-RAG-safe global timeout: the backend waits up to LEGAL_RAG_TIMEOUT_MS
// (45s) before answering a chat query, then responds — a 15s default would
// abort legit slow answers. 60s covers chat; per-call overrides can be set
// where a shorter bound is wanted.
axios.defaults.timeout = 60000;