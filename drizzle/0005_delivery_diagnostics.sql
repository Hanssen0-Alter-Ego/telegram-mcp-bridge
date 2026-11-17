-- Only fixed safe categories and numeric codes, never raw Telegram descriptions.
ALTER TABLE deliveries ADD COLUMN telegram_error_code INTEGER;
ALTER TABLE deliveries ADD COLUMN telegram_error_reason TEXT;
