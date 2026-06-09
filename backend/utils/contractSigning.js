import crypto from "crypto";

const OTP_TTL_MINUTES = Number(process.env.CONTRACT_OTP_TTL_MINUTES || 10);
const OTP_SESSION_TTL_MINUTES = Number(process.env.CONTRACT_OTP_SESSION_TTL_MINUTES || 20);
const OTP_MAX_ATTEMPTS = Number(process.env.CONTRACT_OTP_MAX_ATTEMPTS || 5);
const SESSION_SECRET = process.env.JWT_SECRET;

function toBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signValue(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

export function hashOtp(code) {
  return crypto.createHash("sha256").update(String(code || "")).digest("hex");
}

export function generateOtpCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

export function getOtpConfig() {
  return {
    ttlMinutes: OTP_TTL_MINUTES,
    maxAttempts: OTP_MAX_ATTEMPTS,
  };
}

export function buildOtpSessionToken(payload) {
  const expiresAtMs = Date.now() + OTP_SESSION_TTL_MINUTES * 60 * 1000;
  const body = {
    otpId: Number(payload.otpId),
    contractId: Number(payload.contractId),
    caseId: Number(payload.caseId),
    versionNo: Number(payload.versionNo),
    signerUserId: Number(payload.signerUserId),
    signerRole: String(payload.signerRole || "").toUpperCase(),
    exp: expiresAtMs,
    nonce: crypto.randomBytes(12).toString("hex"),
  };

  const encoded = toBase64Url(JSON.stringify(body));
  const signature = signValue(encoded);
  return `${encoded}.${signature}`;
}

export function verifyOtpSessionToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("otpSessionId is required");
  }

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    throw new Error("Invalid otpSessionId format");
  }

  const expected = signValue(encoded);
  if (expected !== signature) {
    throw new Error("Invalid otpSessionId signature");
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(encoded));
  } catch {
    throw new Error("Invalid otpSessionId payload");
  }

  if (!payload?.exp || Number(payload.exp) < Date.now()) {
    throw new Error("otpSessionId expired");
  }

  return payload;
}

export function canonicalizeContractText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export function hashCanonicalText(text) {
  return crypto.createHash("sha256").update(canonicalizeContractText(text)).digest("hex");
}
