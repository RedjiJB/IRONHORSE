-- Restoring Settings, Slice Q: a real place to set the chat assistant's
-- LLM provider keys from the dashboard, instead of only from the
-- server's own .env (src/domain/chat.ts's PROVIDER_CHAIN previously read
-- process.env only, with no way to configure it short of SSH access).
-- Singleton row, same pattern as notification_settings.
CREATE TABLE llm_settings (
  deepseek_api_key   TEXT,
  anthropic_api_key  TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO llm_settings DEFAULT VALUES;
