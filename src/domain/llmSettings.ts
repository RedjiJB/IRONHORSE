// Restoring Settings, Slice Q: real place to configure the chat
// assistant's LLM provider keys from the dashboard. Singleton row, same
// pattern as notification_settings.ts. The raw keys are only ever read
// internally (by chat.ts, to actually make the call) -- the façade's own
// GET route exposes configured booleans only, never the key values,
// same "never send a secret back to the client" rule webhookTargets.ts
// already follows for its own secret column.
import { pool } from "../db/pool.js";

export type LlmSettings = {
  deepseek_api_key: string | null;
  anthropic_api_key: string | null;
  openai_api_key: string | null;
  updated_at: string;
};

export async function getLlmSettings(): Promise<LlmSettings> {
  const result = await pool.query("SELECT * FROM llm_settings LIMIT 1");
  return result.rows[0] as LlmSettings;
}

// Empty-string means "clear this key" (a masked input's own Clear
// action), distinct from omitted (leave unchanged) -- same distinction
// notification_settings' COALESCE-against-existing shape draws for
// "not supplied," done explicitly here since NULL itself is a valid
// target value (clearing a key).
export async function updateLlmSettings(patch: { deepseekApiKey?: string | null; anthropicApiKey?: string | null; openaiApiKey?: string | null }): Promise<LlmSettings> {
  const result = await pool.query(
    `UPDATE llm_settings SET
       deepseek_api_key = CASE WHEN $1::boolean THEN $2 ELSE deepseek_api_key END,
       anthropic_api_key = CASE WHEN $3::boolean THEN $4 ELSE anthropic_api_key END,
       openai_api_key = CASE WHEN $5::boolean THEN $6 ELSE openai_api_key END,
       updated_at = now()
     RETURNING *`,
    [
      patch.deepseekApiKey !== undefined, patch.deepseekApiKey === undefined ? null : (patch.deepseekApiKey || null),
      patch.anthropicApiKey !== undefined, patch.anthropicApiKey === undefined ? null : (patch.anthropicApiKey || null),
      patch.openaiApiKey !== undefined, patch.openaiApiKey === undefined ? null : (patch.openaiApiKey || null),
    ],
  );
  return result.rows[0] as LlmSettings;
}
