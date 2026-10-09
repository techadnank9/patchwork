-- Patchwork: ClickHouse schema. Append only. Run each statement once.
-- Insert with JSONEachRow. Leave ts out so the DEFAULT fills it.

CREATE TABLE IF NOT EXISTS scans (
  created_at DateTime64(3) DEFAULT now64(3),
  scan_id    String,
  token      String,                              -- secret for the private report link
  team       String,
  repo_url   String,
  is_public  UInt8,                               -- 1 = team agreed to be named on the board
  source     LowCardinality(String) DEFAULT 'room' -- room | public_dataset | fixture | sample (only room reaches the board)
) ENGINE = MergeTree ORDER BY (created_at, scan_id);

CREATE TABLE IF NOT EXISTS pipeline_events (
  ts          DateTime64(3) DEFAULT now64(3),
  scan_id     String,
  team        String,
  stage       LowCardinality(String),             -- queued cloning scanning triaging planning fixing verifying done error
  detail      String,
  duration_ms UInt32 DEFAULT 0
) ENGINE = MergeTree ORDER BY (ts, scan_id);

CREATE TABLE IF NOT EXISTS findings (
  ts               DateTime64(3) DEFAULT now64(3),
  finding_id       String,
  scan_id          String,
  rule_id          String,
  path             String,
  line             UInt32,
  end_line         UInt32,
  language         LowCardinality(String),
  semgrep_severity LowCardinality(String),
  message          String,
  snippet          String                          -- secrets masked BEFORE insert
) ENGINE = MergeTree ORDER BY (rule_id, scan_id, finding_id);

CREATE TABLE IF NOT EXISTS verdicts (
  ts          DateTime64(3) DEFAULT now64(3),
  finding_id  String,
  scan_id     String,
  verdict     LowCardinality(String),             -- real | noise
  severity    LowCardinality(String),             -- high | medium | low
  bug_class   LowCardinality(String),             -- injection secrets auth packages crypto other
  title       String,
  why         String,
  fix_hint    String,
  confidence  Float32,
  backend     LowCardinality(String) DEFAULT 'guild',
  session_url String,
  latency_ms  UInt32
) ENGINE = MergeTree ORDER BY (scan_id, finding_id);

CREATE TABLE IF NOT EXISTS plans (
  ts          DateTime64(3) DEFAULT now64(3),
  scan_id     String,
  plan_json   String,
  session_url String,
  latency_ms  UInt32
) ENGINE = MergeTree ORDER BY (scan_id, ts);

CREATE TABLE IF NOT EXISTS fixes (
  ts           DateTime64(3) DEFAULT now64(3),
  fix_id       String,
  finding_id   String,
  scan_id      String,
  attempt      UInt8,
  status       LowCardinality(String),            -- verified | failed | needs_human
  memory_hit   UInt8 DEFAULT 0,                   -- 1 = a proven fix for this rule was given to the fixer
  explanation  String,
  diff         String,
  syntax_ok    UInt8,
  finding_gone UInt8,
  new_issues   UInt16,
  error        String,
  session_url  String,
  latency_ms   UInt32
) ENGINE = MergeTree ORDER BY (scan_id, finding_id, ts);

CREATE TABLE IF NOT EXISTS fix_memory (
  ts           DateTime64(3) DEFAULT now64(3),
  rule_id      String,
  language     LowCardinality(String),
  explanation  String,
  diff         String,
  from_scan_id String
) ENGINE = MergeTree ORDER BY (rule_id, ts);

-- Each repo's newest room scan. Every screen reads through this, so a rescan never double counts.
CREATE VIEW IF NOT EXISTS latest_room_scans AS
SELECT argMax(scan_id, created_at) AS scan_id FROM scans WHERE source = 'room' GROUP BY repo_url;
