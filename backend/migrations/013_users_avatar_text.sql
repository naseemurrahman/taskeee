-- Allow larger avatar payloads (URLs or data URIs for profile photos)
ALTER TABLE users ALTER COLUMN avatar_url TYPE TEXT;
