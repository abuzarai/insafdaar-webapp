import { randomBytes } from "crypto";

// Unguessable stored filename: no user ids, timestamps, or sequential bits
// that would make /uploads URLs guessable (audit #17).
export const randomFileName = (ext = "") =>
  `${randomBytes(12).toString("hex")}${ext}`;