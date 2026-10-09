-- Patchwork: the queries behind the screens.
-- Time every one in the server and show the milliseconds on the board.

-- Q1. Board cells: one row per (named team, bug class) that has real issues. No row means Clean.
SELECT
  s.team                                                        AS team,
  v.bug_class                                                   AS bug_class,
  countIf(v.verdict = 'real')                                   AS real_issues,
  countIf(v.verdict = 'real' AND (f.finding_id != '' OR pf.path != ''))  AS patch_ready,  -- own verified fix, or covered by a verified fix in the same file
  minIf(multiIf(v.severity = 'high', 1, v.severity = 'medium', 2, 3),
        v.verdict = 'real' AND f.finding_id = '' AND pf.path = '')       AS worst_open  -- 0 none, 1 high, 2 medium, 3 low
FROM verdicts AS v
INNER JOIN scans AS s ON s.scan_id = v.scan_id
INNER JOIN findings AS fnd ON fnd.finding_id = v.finding_id
LEFT JOIN (SELECT DISTINCT finding_id FROM fixes WHERE status = 'verified') AS f
       ON f.finding_id = v.finding_id
LEFT JOIN (SELECT DISTINCT fi.scan_id AS scan_id, fi.path AS path
           FROM fixes AS fx INNER JOIN findings AS fi ON fi.finding_id = fx.finding_id
           WHERE fx.status = 'verified') AS pf
       ON pf.scan_id = v.scan_id AND pf.path = fnd.path
WHERE s.is_public = 1
  AND s.source = 'room'
  AND v.scan_id IN (SELECT scan_id FROM latest_room_scans)
GROUP BY team, bug_class
HAVING real_issues > 0
ORDER BY team, bug_class;

-- Q2. Room totals: every room project counts, named or not. Newest scan per repo only.
SELECT
  (SELECT count() FROM latest_room_scans)                                                   AS projects,
  (SELECT count() FROM findings WHERE scan_id IN (SELECT scan_id FROM latest_room_scans))                 AS raw_findings,
  (SELECT countIf(verdict = 'real')  FROM verdicts WHERE scan_id IN (SELECT scan_id FROM latest_room_scans)) AS real_issues,
  (SELECT countIf(verdict = 'noise') FROM verdicts WHERE scan_id IN (SELECT scan_id FROM latest_room_scans)) AS noise_removed,
  (SELECT uniqExactIf(finding_id, status = 'verified') FROM fixes WHERE scan_id IN (SELECT scan_id FROM latest_room_scans)) AS verified_fixes,
  (SELECT uniqExactIf(finding_id, status = 'verified' AND memory_hit = 1) FROM fixes WHERE scan_id IN (SELECT scan_id FROM latest_room_scans)) AS memory_assisted_fixes;

-- Q3. Variant hunt: the same rule firing as a real issue in more than one project.
SELECT
  f.rule_id                AS rule_id,
  any(v.title)             AS title,
  uniqExact(s.repo_url)    AS projects,
  count()                  AS hits
FROM findings AS f
INNER JOIN verdicts AS v ON v.finding_id = f.finding_id
INNER JOIN scans    AS s ON s.scan_id = f.scan_id
WHERE v.verdict = 'real' AND f.scan_id IN (SELECT scan_id FROM latest_room_scans)
GROUP BY rule_id
HAVING projects > 1
ORDER BY projects DESC, hits DESC
LIMIT 10;

-- Q4. Headline: the flaw AI wrote most often in this room.
SELECT v.bug_class AS bug_class, uniqExact(s.repo_url) AS projects, count() AS issues
FROM verdicts AS v
INNER JOIN scans AS s ON s.scan_id = v.scan_id
WHERE v.verdict = 'real' AND v.scan_id IN (SELECT scan_id FROM latest_room_scans)
GROUP BY bug_class
ORDER BY projects DESC, issues DESC
LIMIT 1;

-- Q5. Speed: how long from finding to verified fix, and agent latency.
SELECT
  round(quantile(0.5)(latency_ms) / 1000, 1) AS median_fix_seconds,
  round(quantile(0.9)(latency_ms) / 1000, 1) AS p90_fix_seconds,
  count()                                    AS verified
FROM fixes
WHERE status = 'verified'
  AND scan_id IN (SELECT scan_id FROM scans WHERE source = 'room');

-- Q6. Live feed: last 30 pipeline events. Hide team names of teams that did not opt in.
SELECT e.ts AS ts, if(s.is_public = 1, e.team, 'A team') AS team, e.stage AS stage, e.detail AS detail, e.duration_ms AS duration_ms
FROM pipeline_events AS e
INNER JOIN scans AS s ON s.scan_id = e.scan_id
WHERE s.source = 'room'
ORDER BY e.ts DESC
LIMIT 30;

-- Q7. Room memory lookup: newest proven fix for a rule (used before calling the fixer).
SELECT explanation, diff FROM fix_memory WHERE rule_id = {rule_id:String} ORDER BY ts DESC LIMIT 1;

-- Q8. Private report: everything for one scan (check the token in the server first).
SELECT
  f.finding_id AS finding_id, f.rule_id AS rule_id, f.path AS path, f.line AS line, f.snippet AS snippet,
  v.verdict AS verdict, v.severity AS severity, v.bug_class AS bug_class, v.title AS title,
  v.why AS why, v.fix_hint AS fix_hint, v.session_url AS triage_session
FROM findings AS f
INNER JOIN verdicts AS v ON v.finding_id = f.finding_id
WHERE f.scan_id = {scan_id:String}
ORDER BY v.verdict = 'real' DESC, multiIf(v.severity = 'high', 1, v.severity = 'medium', 2, 3), f.path, f.line;

-- H1. History: every scan ever run, newest first, with its counts and latest stage.
SELECT
  s.scan_id AS scan_id, s.created_at AS created_at, s.team AS team, s.repo_url AS repo_url, s.is_public AS is_public, s.source AS source,
  (SELECT count() FROM findings WHERE scan_id = s.scan_id) AS findings,
  (SELECT countIf(verdict = 'real') FROM verdicts WHERE scan_id = s.scan_id) AS real_issues,
  (SELECT countIf(verdict = 'noise') FROM verdicts WHERE scan_id = s.scan_id) AS noise,
  (SELECT uniqExactIf(finding_id, status = 'verified') FROM fixes WHERE scan_id = s.scan_id) AS verified_fixes,
  (SELECT uniqExactIf(finding_id, status = 'needs_human') FROM fixes WHERE scan_id = s.scan_id) AS needs_human,
  (SELECT argMax(stage, ts) FROM pipeline_events WHERE scan_id = s.scan_id) AS stage,
  (SELECT argMax(detail, ts) FROM pipeline_events WHERE scan_id = s.scan_id) AS detail,
  (SELECT groupArrayDistinct(bug_class) FROM verdicts WHERE scan_id = s.scan_id AND verdict = 'real') AS bug_classes
FROM scans AS s
ORDER BY s.created_at DESC
LIMIT 200;
