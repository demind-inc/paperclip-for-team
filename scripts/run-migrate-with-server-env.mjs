#!/usr/bin/env node
/**
 * Runs DB migrations using env from server/.env so the same DB as the server is migrated.
 * Use when DATABASE_URL (or other DB config) is set in server/.env.
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const serverEnvPath = path.resolve(process.cwd(), "server", ".env");
if (existsSync(serverEnvPath)) {
  const raw = readFileSync(serverEnvPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawVal] = match;
    let val = (rawVal ?? "").trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(pnpmBin, ["--filter", "@paperclipai/db", "migrate"], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});
child.on("exit", (code, signal) => {
  process.exit(signal ? 128 + signal : code ?? 0);
});
