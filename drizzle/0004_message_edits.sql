-- Mapping is created only after proving the original sent receipt's fingerprint.
-- Unknown/pending edits retain the lock: never guess whether Telegram applied them.
CREATE TABLE edit_targets (
 owner TEXT NOT NULL,
 original_request_id TEXT NOT NULL,
 chat_id TEXT NOT NULL,
 topic_id INTEGER NOT NULL,
 message_id INTEGER NOT NULL,
 active_edit_id TEXT,
 PRIMARY KEY (owner, original_request_id)
);
