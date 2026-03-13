import type { IncomingHttpHeaders } from "node:http";
import type { Request } from "express";
import * as jose from "jose";
import { logger } from "../middleware/logger.js";

export type SupabaseSessionUser = {
  id: string;
  email: string | null;
  name: string | null;
};

export type SupabaseSessionResult = {
  session: { id: string; userId: string };
  user: SupabaseSessionUser;
};

type JwtPayload = {
  sub: string;
  email?: string | null;
  user_metadata?: { name?: string };
};

function parsePayload(payload: jose.JWTPayload): JwtPayload | null {
  const sub = payload.sub;
  if (!sub || typeof sub !== "string") return null;
  const email = payload.email;
  const userMetadata = payload.user_metadata as { name?: string } | undefined;
  return {
    sub,
    email: typeof email === "string" ? email : null,
    user_metadata: userMetadata,
  };
}

/**
 * Verify a Supabase access token (JWT). Tries HS256 with secret first, then RS256 via JWKS if supabaseUrl is set.
 * Supabase projects may use either the legacy JWT Secret (HS256) or the JWKS endpoint (RS256).
 */
export async function verifySupabaseJwt(
  token: string,
  opts: { secret?: string; supabaseUrl?: string },
): Promise<JwtPayload | null> {
  const { secret, supabaseUrl } = opts;

  if (secret) {
    try {
      const secretBytes = new TextEncoder().encode(secret);
      const { payload } = await jose.jwtVerify(token, secretBytes, {
        algorithms: ["HS256"],
        clockTolerance: 10,
      });
      return parsePayload(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("algorithm") && !msg.includes("signature")) {
        logger.debug({ err: msg }, "Supabase JWT HS256 verification failed");
      }
    }
  }

  if (supabaseUrl) {
    try {
      const base = supabaseUrl.replace(/\/$/, "");
      const jwksUrl = `${base}/auth/v1/.well-known/jwks.json`;
      const jwks = jose.createRemoteJWKSet(new URL(jwksUrl));
      const { payload } = await jose.jwtVerify(token, jwks, {
        algorithms: ["RS256", "ES256"],
        clockTolerance: 10,
      });
      return parsePayload(payload);
    } catch (err) {
      logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        "Supabase JWT JWKS verification failed",
      );
      return null;
    }
  }

  return null;
}

export function getSupabaseBearerToken(req: Request): string | null {
  const auth = req.header("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function getBearerTokenFromHeaders(headers: IncomingHttpHeaders | Headers): string | null {
  const auth =
    "get" in headers
      ? (headers as Headers).get("authorization")
      : (headers as IncomingHttpHeaders).authorization;
  const value = typeof auth === "string" ? auth : Array.isArray(auth) ? auth[0] : undefined;
  if (!value || !value.toLowerCase().startsWith("bearer ")) return null;
  const token = value.slice(7).trim();
  return token || null;
}

export type SupabaseAuthOptions = {
  jwtSecret?: string;
  supabaseUrl?: string;
};

/**
 * Resolve session from Supabase JWT when present in Authorization header.
 * Use when auth provider is Supabase; does not read cookies.
 */
export async function resolveSupabaseSession(
  req: Request,
  opts: SupabaseAuthOptions,
): Promise<SupabaseSessionResult | null> {
  const token = getSupabaseBearerToken(req);
  if (!token) return null;
  return resolveSupabaseSessionFromToken(token, opts);
}

/**
 * Resolve session from a Supabase JWT string (e.g. from headers for WebSocket).
 */
export async function resolveSupabaseSessionFromToken(
  token: string,
  opts: SupabaseAuthOptions,
): Promise<SupabaseSessionResult | null> {
  const payload = await verifySupabaseJwt(token, opts);
  if (!payload) return null;
  const name =
    (payload.user_metadata?.name as string | undefined) ??
    (payload.email ? payload.email.split("@")[0] : null);
  return {
    session: { id: `supabase:${payload.sub}`, userId: payload.sub },
    user: {
      id: payload.sub,
      email: payload.email ?? null,
      name: name ?? null,
    },
  };
}

/**
 * Resolve session from Supabase JWT in headers (for WebSocket upgrade).
 */
export async function resolveSupabaseSessionFromHeaders(
  headers: IncomingHttpHeaders | Headers,
  opts: SupabaseAuthOptions,
): Promise<SupabaseSessionResult | null> {
  const token = getBearerTokenFromHeaders(headers);
  if (!token) return null;
  return resolveSupabaseSessionFromToken(token, opts);
}

export type SupabaseUserProfile = {
  email: string | null;
  name: string | null;
};

/**
 * Fetch a user's profile (email, name) from Supabase Auth Admin API.
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set.
 * Returns null if not configured, user not found, or on error.
 */
export async function getSupabaseUserById(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
): Promise<SupabaseUserProfile | null> {
  const base = supabaseUrl.replace(/\/$/, "");
  const url = `${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      email?: string | null;
      user_metadata?: { full_name?: string; name?: string } | null;
    };
    const email =
      typeof data.email === "string" && data.email.trim()
        ? data.email.trim()
        : null;
    const meta = data.user_metadata;
    const name =
      (typeof meta?.full_name === "string" && meta.full_name.trim()
        ? meta.full_name.trim()
        : null) ??
      (typeof meta?.name === "string" && meta.name.trim() ? meta.name.trim() : null) ??
      (email ? email.split("@")[0] : null);
    return { email, name };
  } catch {
    return null;
  }
}
