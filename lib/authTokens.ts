import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getOrgMap } from "./data";

/**
 * Replaces "trust whatever subjectId string the request body says" with a
 * signed, expiring token — the request has to prove who it's acting as, not
 * just assert it. A real deployment would use a KMS-backed key and short
 * per-session secrets, not one process-lifetime one.
 *
 * The secret is persisted to disk rather than kept only in a module-level
 * variable: Next.js dev mode compiles each API route as its own bundle, so a
 * plain in-memory `crypto.randomBytes()` at module load is NOT guaranteed to
 * be the same instance across /api/login and /api/run — a token issued by
 * one could fail verification in the other. Reading/writing a shared file
 * avoids that dev-mode footgun without needing an external secrets store.
 */
const SECRET_PATH = path.join(process.cwd(), "data", ".auth-secret");

function loadOrCreateSecret(): string {
  try {
    return fs.readFileSync(SECRET_PATH, "utf-8").trim();
  } catch {
    const secret = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    fs.writeFileSync(SECRET_PATH, secret);
    return secret;
  }
}

const SERVER_SECRET = loadOrCreateSecret();
const TTL_SECONDS = 300;

interface TokenPayload {
  subjectId: string;
  issuedAt: number;
  expiresAt: number;
}

function sign(payloadB64: string): string {
  return crypto.createHmac("sha256", SERVER_SECRET).update(payloadB64).digest("hex");
}

export function issueToken(subjectId: string): { token: string; expiresAt: number } | null {
  if (!getOrgMap()[subjectId]) return null; // only real org identities can be issued a token
  const now = Date.now();
  const payload: TokenPayload = { subjectId, issuedAt: now, expiresAt: now + TTL_SECONDS * 1000 };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(payloadB64);
  return { token: `${payloadB64}.${sig}`, expiresAt: payload.expiresAt };
}

export interface TokenVerifyResult {
  valid: boolean;
  subjectId?: string;
  reason: string;
}

export function verifyToken(token: string | null | undefined): TokenVerifyResult {
  if (!token) return { valid: false, reason: "no token presented" };
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "malformed token" };
  const [payloadB64, sig] = parts;

  const expectedSig = sign(payloadB64);
  // constant-time compare so signature checks don't leak timing information
  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expectedSig, "hex");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: "signature does not match — token was forged or corrupted" };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return { valid: false, reason: "malformed token payload" };
  }

  if (Date.now() > payload.expiresAt) {
    return { valid: false, reason: "token expired" };
  }
  if (!getOrgMap()[payload.subjectId]) {
    return { valid: false, reason: "token subject is not a known identity" };
  }

  return { valid: true, subjectId: payload.subjectId, reason: "signature and expiry valid" };
}
