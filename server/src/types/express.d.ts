export {};

// Augment Express Request with `actor`.
//
// Important: Use module augmentation (not global `namespace Express`) so this
// works with Express v5's bundled types as well as `@types/express`.
declare module "express-serve-static-core" {
  interface Request {
    actor: {
      type: "board" | "agent" | "none";
      userId?: string;
      agentId?: string;
      companyId?: string;
      companyIds?: string[];
      isInstanceAdmin?: boolean;
      keyId?: string;
      runId?: string;
      source?: "local_implicit" | "session" | "agent_key" | "agent_jwt" | "none";
    };
    /** Set by auth middleware when session is resolved (Better Auth or Supabase); used by get-session. */
    sessionUser?: { id: string; email: string | null; name: string | null };
  }
}
