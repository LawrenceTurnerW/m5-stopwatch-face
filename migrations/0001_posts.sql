-- みんなの投稿
CREATE TABLE posts (
  id          TEXT PRIMARY KEY,           -- 公開する ID (推測しにくい乱数)
  name        TEXT NOT NULL,              -- コードの // @name
  description TEXT NOT NULL DEFAULT '',   -- コードの // @description
  code        TEXT NOT NULL,
  code_hash   TEXT NOT NULL UNIQUE,       -- 同じコードの二重投稿を防ぐ
  delete_hash TEXT NOT NULL,              -- 投稿者だけが持つ削除キーの SHA-256
  reports     INTEGER NOT NULL DEFAULT 0, -- 通報の数。しきい値以上で一覧から外れる
  created_at  INTEGER NOT NULL            -- 秒 (UNIX 時刻)
);
CREATE INDEX posts_created ON posts (created_at DESC);

-- 通報。同じ人 (IP のハッシュ) は 1 件だけ数える
CREATE TABLE reports (
  post_id TEXT NOT NULL,
  who     TEXT NOT NULL,
  PRIMARY KEY (post_id, who)
);
