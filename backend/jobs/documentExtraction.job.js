import cron from "node-cron";

import {
  enqueueApprovedDocsMissingExtraction,
  processExtractionQueue,
} from "../services/documentExtraction.service.js";

export function startDocumentExtractionJob() {
  cron.schedule("*/2 * * * *", async () => {
    try {
      const queued = await enqueueApprovedDocsMissingExtraction(50);
      if (queued) {
        console.log(`[CRON] Document extraction queued ${queued} missing approved documents`);
      }

      const result = await processExtractionQueue(5);
      if (result.processed) {
        console.log(
          `[CRON] Document extraction processed=${result.processed}, success=${result.succeeded}, failed=${result.failed}`
        );
      }
    } catch (error) {
      console.error("[CRON] Document extraction job crashed:", error);
    }
  });
}
