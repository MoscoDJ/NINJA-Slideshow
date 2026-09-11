import crypto from "crypto";

const isProd = process.env.NODE_ENV === "production";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Revisa .env.example.`,
    );
  }
  return value;
}

/**
 * En produccion el secreto es obligatorio: con un fallback conocido cualquiera
 * puede firmar su propia cookie de admin. En desarrollo generamos uno efimero,
 * lo que invalida las sesiones al reiniciar pero nunca es adivinable.
 */
function resolveSessionSecret(): string {
  if (isProd) {
    const secret = required("SESSION_SECRET");
    if (secret.length < 32) {
      throw new Error(
        "SESSION_SECRET debe tener al menos 32 caracteres. " +
          "Genera uno con: openssl rand -hex 32",
      );
    }
    return secret;
  }
  return (
    process.env.SESSION_SECRET ?? crypto.randomBytes(32).toString("hex")
  );
}

function resolveAdminPasswords(): string[] {
  const passwords = [process.env.ADMIN_PASSWORD, process.env.ADMIN2_PASSWORD]
    .filter((p): p is string => Boolean(p && p.trim()));

  if (passwords.length === 0) {
    throw new Error(
      "Define al menos ADMIN_PASSWORD para poder entrar al panel.",
    );
  }
  if (isProd && passwords.some((p) => p.length < 12)) {
    throw new Error(
      "Las contrasenas de admin deben tener al menos 12 caracteres en produccion.",
    );
  }
  return passwords;
}

const spacesRegion = process.env.SPACES_REGION ?? "sfo3";
const spacesHost =
  process.env.SPACES_ENDPOINT ?? `${spacesRegion}.digitaloceanspaces.com`;
const bucket = process.env.BUCKET_NAME ?? "ninjacdn";

export const config = {
  isProd,
  port: Number.parseInt(process.env.PORT ?? "5000", 10),

  /**
   * Numero de proxies de confianza delante del server. Necesario para que el
   * rate limiter lea la IP real; `true` (confiar en todos) permitiria falsear
   * X-Forwarded-For y saltarse el limite de intentos de login.
   */
  trustProxy: Number.parseInt(process.env.TRUST_PROXY ?? "1", 10),

  sessionSecret: resolveSessionSecret(),
  adminPasswords: resolveAdminPasswords(),

  spaces: {
    region: spacesRegion,
    host: spacesHost,
    endpoint: `https://${spacesHost}`,
    bucket,
    cdnHost:
      process.env.SPACES_CDN_ENDPOINT ??
      `${spacesRegion}.cdn.digitaloceanspaces.com`,
    key: required("SPACES_KEY"),
    secret: required("SPACES_SECRET_KEY"),
    folder: "slideshow",
  },

  /** Poner en "true" una sola vez para aplicar la politica CORS del bucket. */
  configureBucketCors: process.env.CONFIGURE_BUCKET_CORS === "true",

  /** Tope de subida: 2 GB, el limite que promete el panel de admin. */
  maxUploadBytes: 2 * 1024 * 1024 * 1024,
} as const;

export const cdnBaseUrl = `https://${config.spaces.bucket}.${config.spaces.cdnHost}`;
