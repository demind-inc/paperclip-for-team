import type { IncomingHttpHeaders } from "node:http";
import type { Request } from "express";
import * as jose from "jose";

export type SupabaseSessionUser = {
  id: string;
  email: string | null;
  name: string | null;
};

export type SupabaseSessionResult = {
  session: { id: string; userId: string };
  user: SupabaseSessionUser;
};

/**
 * Verify a Supabase access token (JWT) and return the user payload.
 * Uses SUPABASE_JWT_SECRET (Project Settings > API > JWT Secret) for HS256 verification.
 */
export async function verifySupabaseJwt(
  token: string,
  secret: string,
): Promise<{ sub: string; email?: string | null; user_metadata?: { name?: string } } | null> {
  try {
    const secretBytes = new TextEncoder().encode(secret);
    const { payload } = await jose.jwtVerify(token, secretBytes, {
      algorithms: ["HS256"],
      clockTolerance: 10,
    });
    const sub = payload.sub;
    if (!sub || typeof sub !== "string") return null;
    const email = payload.email;
    const userMetadata = payload.user_metadata as { name?: string } | undefined;
    const name = userMetadata?.name ?? payload.name;
    return {
      sub,
      email: typeof email === "string" ? email : null,
      user_metadata: userMetadata,
    };
  } catch {
    return null;
  }
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

/**
 * Resolve session from Supabase JWT when present in Authorization header.
 * Use when auth provider is Supabase; does not read cookies.
 */
export async function resolveSupabaseSession(
  req: Request,
  jwtSecret: string,
): Promise<SupabaseSessionResult | null> {
  const token = getSupabaseBearerToken(req);
  if (!token) return null;
  return resolveSupabaseSessionFromToken(token, jwtSecret);
}

/**
 * Resolve session from a Supabase JWT string (e.g. from headers for WebSocket).
 */
export async function resolveSupabaseSessionFromToken(
  token: string,
  jwtSecret: string,
): Promise<SupabaseSessionResult | null> {
  const payload = await verifySupabaseJwt(token, jwtSecret);
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
  jwtSecret: string,
): Promise<SupabaseSessionResult | null> {
  const token = getBearerTokenFromHeaders(headers);
  if (!token) return null;
  return resolveSupabaseSessionFromToken(token, jwtSecret);
}
