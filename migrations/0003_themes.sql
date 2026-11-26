-- みんなの配色 (6 色と名前だけ。文字盤の画像や効果音は含めない)
CREATE TABLE themes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  colors      TEXT NOT NULL UNIQUE,       -- "#rrggbb" を 6 つ、カンマ区切り (小文字)。同じ配色の二重投稿を防ぐ
  delete_hash TEXT NOT NULL,
  reports     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX themes_created ON themes (created_at DESC);
