// Augment Express Request with `actor`.
// Uses global namespace so it merges with @types/express-serve-static-core's Express.Request.
declare global {
  namespace Express {
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
    }
  }
}

export {};
