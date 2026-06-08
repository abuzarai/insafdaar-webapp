import dotenv from "dotenv";

import { enqueueApprovedDocsMissingExtraction } from "../services/documentExtraction.service.js";

dotenv.config();

async function run() {
  const queued = await enqueueApprovedDocsMissingExtraction(5000);
  console.log(`[BACKFILL] queued ${queued} approved docs for extraction`);
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("[BACKFILL] failed:", error);
    process.exit(1);
  });
