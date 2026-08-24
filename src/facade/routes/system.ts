// Dashboard restoration, Slice J: the vendored dashboard's system-status
// card (API/DB/AI-provider health) was fully domain-agnostic -- the only
// row dropped is vector DB, since this façade has no pgvector. AI
// "configured" reads the same source the chat façade itself resolves a
// key from (src/domain/chat.ts's callDeepSeek/callAnthropic: the
// llm_settings DB row first, falling back to the env var) -- not a
// fresh LLM call, which would be wasteful and slow on every dashboard
// load, and not env-only, since Settings (Slice Q) can set these without
// touching .env at all.
import type { Router } from "../router.js";
import { sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import { pool } from "../../db/pool.js";
import { getLlmSettings } from "../../domain/llmSettings.js";
import pkg from "../../../package.json" with { type: "json" };

export function registerSystemRoutes(router: Router): void {
  router.get("/api/v1/system/status", async (req, res) => {
    try {
      await requireStaffRole(req);

      let dbStatus: "connected" | "offline" = "offline";
      try {
        await pool.query("SELECT 1");
        dbStatus = "connected";
      } catch {
        dbStatus = "offline";
      }

      const llmSettings = await getLlmSettings();
      const providers = [
        { name: "deepseek", configured: Boolean(llmSettings.deepseek_api_key || process.env.DEEPSEEK_API_KEY) },
        { name: "openai", configured: Boolean(llmSettings.openai_api_key || process.env.OPENAI_API_KEY) },
        { name: "anthropic", configured: Boolean(llmSettings.anthropic_api_key || process.env.ANTHROPIC_API_KEY) },
      ];

      sendJson(res, 200, {
        api: { status: "connected", version: pkg.version },
        database: { status: dbStatus },
        ai: { providers, configured: providers.some((p) => p.configured) },
      });
    } catch (err) {
      sendError(res, err);
    }
  });
}
