import { getSupabaseClient, getSupabaseAccessToken, isSupabaseAuthEnabled } from "@/lib/supabase";

export type AuthSession = {
  session: { id: string; userId: string };
  user: { id: string; email: string | null; name: string | null };
};

function toSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const sessionValue = record.session;
  const userValue = record.user;
  if (!sessionValue || typeof sessionValue !== "object") return null;
  if (!userValue || typeof userValue !== "object") return null;
  const session = sessionValue as Record<string, unknown>;
  const user = userValue as Record<string, unknown>;
  if (typeof session.id !== "string" || typeof session.userId !== "string") return null;
  if (typeof user.id !== "string") return null;
  return {
    session: { id: session.id, userId: session.userId },
    user: {
      id: user.id,
      email: typeof user.email === "string" ? user.email : null,
      name: typeof user.name === "string" ? user.name : null,
    },
  };
}

async function authPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/auth${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (payload as { error?: { message?: string } | string } | null)?.error &&
      typeof (payload as { error?: { message?: string } | string }).error === "object"
        ? ((payload as { error?: { message?: string } }).error?.message ?? `Request failed: ${res.status}`)
        : (payload as { error?: string } | null)?.error ?? `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return payload;
}

async function getSessionFromApi(token: string | null): Promise<AuthSession | null> {
  if (!token) return null;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch("/api/auth/get-session", { credentials: "include", headers });
  if (res.status === 401) return null;
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Failed to load session (${res.status})`);
  const direct = toSession(payload);
  if (direct) return direct;
  const nested =
    payload && typeof payload === "object" ? toSession((payload as Record<string, unknown>).data) : null;
  return nested;
}

export const authApi = {
  getSession: async (): Promise<AuthSession | null> => {
    if (isSupabaseAuthEnabled()) {
      const token = await getSupabaseAccessToken();
      return getSessionFromApi(token);
    }
    const res = await fetch("/api/auth/get-session", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (res.status === 401) return null;
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`Failed to load session (${res.status})`);
    }
    const direct = toSession(payload);
    if (direct) return direct;
    const nested =
      payload && typeof payload === "object" ? toSession((payload as Record<string, unknown>).data) : null;
    return nested;
  },

  signInEmail: async (input: { email: string; password: string }) => {
    if (isSupabaseAuthEnabled()) {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase not configured");
      const { error } = await supabase.auth.signInWithPassword({
        email: input.email.trim(),
        password: input.password,
      });
      if (error) throw new Error(error.message);
      return;
    }
    await authPost("/sign-in/email", input);
  },

  signUpEmail: async (input: { name: string; email: string; password: string }) => {
    if (isSupabaseAuthEnabled()) {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase not configured");
      const { error } = await supabase.auth.signUp({
        email: input.email.trim(),
        password: input.password,
        options: { data: { name: input.name.trim() || undefined } },
      });
      if (error) throw new Error(error.message);
      return;
    }
    await authPost("/sign-up/email", input);
  },

  signOut: async () => {
    if (isSupabaseAuthEnabled()) {
      const supabase = getSupabaseClient();
      if (supabase) await supabase.auth.signOut();
      return;
    }
    await authPost("/sign-out", {});
  },
};
