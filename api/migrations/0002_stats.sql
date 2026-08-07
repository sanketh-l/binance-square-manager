ALTER TABLE posts ADD COLUMN views INTEGER;
ALTER TABLE posts ADD COLUMN reactions INTEGER;
ALTER TABLE posts ADD COLUMN followers INTEGER;
ALTER TABLE posts ADD COLUMN scraped_at TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_scraped ON posts(scraped_at);