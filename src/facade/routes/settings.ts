// Restoring Settings, Slice Q: a real, small settings surface -- not the
// vendored 2320-line multi-domain shell (e-invoicing, translation
// manager, backup/restore have no fit here). Profile is served by the
// already-existing GET /api/v1/users/me/ (auth.ts); this file adds the
// two genuinely new pieces: LLM provider key configuration (the chat
// assistant's one real, already-blocking gap) and self-service password
// change.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireStaffRole, requireAdminRole } from "../auth.js";
import { getLlmSettings, updateLlmSettings } from "../../domain/llmSettings.js";
import { changeOwnPassword } from "../../domain/users.js";

type LlmPatchBody = { deepseek_api_key?: string | null; anthropic_api_key?: string | null; openai_api_key?: string | null };
type ChangePasswordBody = { current_password?: string; new_password?: string };

export function registerSettingsRoutes(router: Router): void {
  // Admin-gated: these are real credentials for a shared service, not a
  // per-user preference -- same gate as the webhook secrets.
  router.get("/api/v1/settings/llm", async (req, res) => {
    try {
      await requireAdminRole(req);
      const settings = await getLlmSettings();
      sendJson(res, 200, {
        deepseek_configured: Boolean(settings.deepseek_api_key || process.env.DEEPSEEK_API_KEY),
        openai_configured: Boolean(settings.openai_api_key || process.env.OPENAI_API_KEY),
        anthropic_configured: Boolean(settings.anthropic_api_key || process.env.ANTHROPIC_API_KEY),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.patch("/api/v1/settings/llm", async (req, res) => {
    try {
      await requireAdminRole(req);
      const body = await readJsonBody<LlmPatchBody>(req);
      const settings = await updateLlmSettings({
        deepseekApiKey: body.deepseek_api_key,
        anthropicApiKey: body.anthropic_api_key,
        openaiApiKey: body.openai_api_key,
      });
      sendJson(res, 200, {
        deepseek_configured: Boolean(settings.deepseek_api_key || process.env.DEEPSEEK_API_KEY),
        openai_configured: Boolean(settings.openai_api_key || process.env.OPENAI_API_KEY),
        anthropic_configured: Boolean(settings.anthropic_api_key || process.env.ANTHROPIC_API_KEY),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Staff-level: every user changes their own password.
  router.post("/api/v1/users/me/change-password", async (req, res) => {
    try {
      const user = await requireStaffRole(req);
      const body = await readJsonBody<ChangePasswordBody>(req);
      if (!body.current_password || !body.new_password) {
        sendJson(res, 422, { detail: "current_password and new_password are required" });
        return;
      }
      if (body.new_password.length < 8) {
        sendJson(res, 422, { detail: "new_password must be at least 8 characters" });
        return;
      }
      const result = await changeOwnPassword(user.userId, body.current_password, body.new_password);
      if (!result.ok) {
        sendJson(res, result.reason === "wrong_password" ? 401 : 404, {
          detail: result.reason === "wrong_password" ? "Current password is incorrect" : "Not found",
        });
        return;
      }
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });
}
