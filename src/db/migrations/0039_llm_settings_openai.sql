-- Adding OpenAI as a real third provider in the chat assistant's
-- fallback chain, alongside DeepSeek and Anthropic -- requested once a
-- real OpenAI key was available (previously deferred: "no other code
-- changes needed" per chat.ts's own PROVIDER_CHAIN comment).
ALTER TABLE llm_settings ADD COLUMN openai_api_key TEXT;
