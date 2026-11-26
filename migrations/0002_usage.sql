-- AI 生成の回数。1 日ごと、相手ごとに数える (who が '*' の行はサイト全体の合計)
CREATE TABLE usage (
  day TEXT NOT NULL,     -- YYYY-MM-DD (UTC)
  who TEXT NOT NULL,     -- IP のハッシュ、または '*'
  n   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who)
);
