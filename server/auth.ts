import crypto from "crypto";
import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { config } from "./env";

const AUTH_COOKIE = "ninja_auth";
const AUTH_MAX_AGE = 24 * 60 * 60 * 1000;

function hmac(payload: string): string {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update(payload)
    .digest("hex");
}

function signToken(payload: string): string {
  return `${payload}.${hmac(payload)}`;
}

/** Comparacion en tiempo constante que tolera longitudes distintas. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual lanza si los tamanos difieren, asi que los igualamos con
  // un hash de longitud fija antes de comparar.
  const hashA = crypto.createHash("sha256").update(bufA).digest();
  const hashB = crypto.createHash("sha256").update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB) && bufA.length === bufB.length;
}

function verifyToken(token: string): boolean {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, hmac(payload))) return false;

  const [subject, expiry] = payload.split(":");
  if (subject !== "admin") return false;

  const expiresAt = Number.parseInt(expiry, 10);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function isAuthenticated(req: Request): boolean {
  const token = getCookie(req, AUTH_COOKIE);
  return Boolean(token && verifyToken(token));
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "No autorizado" });
}

/** Verifica la contrasena contra todas las validas sin filtrar cual acerto. */
export function isValidAdminPassword(candidate: unknown): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;

  let matched = false;
  for (const password of config.adminPasswords) {
    if (safeEqual(candidate, password)) matched = true;
  }
  return matched;
}

export function issueSession(res: Response): void {
  const token = signToken(`admin:${Date.now() + AUTH_MAX_AGE}`);
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    maxAge: AUTH_MAX_AGE,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(AUTH_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
  });
}

/** Frena el fuerza bruta contra la unica contrasena que protege el panel. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Demasiados intentos. Espera unos minutos." },
});

/** Limite generoso para las rutas de escritura ya autenticadas. */
export const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiadas peticiones." },
});
