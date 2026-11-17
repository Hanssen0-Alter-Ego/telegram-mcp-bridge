CREATE TABLE deliveries (
 owner TEXT NOT NULL,
 id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','sent','rejected','unknown')),
 message_id INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (owner,id)
);
