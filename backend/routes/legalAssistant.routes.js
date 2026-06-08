import express from "express";
import { optionalAuth } from "../middleware/optionalAuth.js";
import {
  queryLegalAssistant,
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  clearConversations,
} from "../controllers/legalAssistant.controller.js";

const router = express.Router();
router.use(optionalAuth);

// POST /api/legal-assistant/query
router.post("/query", queryLegalAssistant);

// Conversation persistence
router.get("/conversations", listConversations);
router.get("/conversations/:id", getConversation);
router.post("/conversations", createConversation);
router.put("/conversations/:id", updateConversation);
router.delete("/conversations/:id", deleteConversation);
router.delete("/conversations", clearConversations);

export default router;
