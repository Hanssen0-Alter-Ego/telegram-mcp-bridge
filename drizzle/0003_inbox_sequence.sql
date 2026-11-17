ALTER TABLE inbox_cursor ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE inbox_v2 (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 epoch INTEGER NOT NULL,
 update_id INTEGER NOT NULL,
 chat_id TEXT NOT NULL,
 topic_id INTEGER NOT NULL,
 message_id INTEGER NOT NULL,
 sent_at INTEGER NOT NULL,
 author TEXT NOT NULL,
 text TEXT NOT NULL,
 UNIQUE(epoch,update_id)
);
--> statement-breakpoint
CREATE INDEX inbox_v2_chat_topic_sequence ON inbox_v2(chat_id,topic_id,sequence);
