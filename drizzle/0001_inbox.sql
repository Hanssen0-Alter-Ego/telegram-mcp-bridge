CREATE TABLE inbox_cursor (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 next_offset INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0,
 lease_id TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE inbox (
 update_id INTEGER PRIMARY KEY,
 chat_id TEXT NOT NULL,
 topic_id INTEGER NOT NULL,
 message_id INTEGER NOT NULL,
 sent_at INTEGER NOT NULL,
 author TEXT NOT NULL,
 text TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX inbox_chat_topic_update ON inbox(chat_id,topic_id,update_id);
