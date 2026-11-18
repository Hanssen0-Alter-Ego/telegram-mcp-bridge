-- Persist verified send scope and reply identity atomically with the pending claim.
ALTER TABLE deliveries ADD COLUMN send_chat_id TEXT;
ALTER TABLE deliveries ADD COLUMN send_topic_id INTEGER;
ALTER TABLE deliveries ADD COLUMN send_kind TEXT;
ALTER TABLE deliveries ADD COLUMN reply_to_json TEXT;
