-- One-shot reset (v2): rebuild every future Sun–Thu day's availability on the
-- new 11:00–20:00 hourly grid for every teacher. v1 left behind stale
-- inactive slots that were referenced by cancelled bookings; this version
-- detaches finalized (cancelled/rejected) bookings first so those rows can be
-- removed too. Slots referenced by active bookings (pending / approved /
-- cancel_requested) are preserved.

-- 1. Cancelled or rejected bookings keep their date/time history but stop
--    holding their slot row hostage.
UPDATE lesson_bookings
SET availability_id = NULL
WHERE status IN ('cancelled', 'rejected');

-- 2. Anything in the future without an active booking reference is stale —
--    delete it so the new grid can populate cleanly.
DELETE FROM teacher_availability
WHERE date >= CURRENT_DATE
  AND id NOT IN (
    SELECT availability_id FROM lesson_bookings
    WHERE availability_id IS NOT NULL
  );

-- 3. For each Sun–Thu in the next 4 weeks, insert each missing 11:00–20:00
--    one-hour grid slot per teacher. The overlap check skips any already
--    existing row (e.g. a slot that survived step 2 because it has an active
--    booking).
WITH dates AS (
  SELECT generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '28 days', '1 day')::date AS d
), valid_dates AS (
  SELECT d FROM dates WHERE EXTRACT(DOW FROM d) BETWEEN 0 AND 4
), times AS (
  SELECT * FROM (VALUES
    ('11:00','12:00'),('12:00','13:00'),('13:00','14:00'),
    ('14:00','15:00'),('15:00','16:00'),('16:00','17:00'),
    ('17:00','18:00'),('18:00','19:00'),('19:00','20:00')
  ) AS t(s,e)
)
INSERT INTO teacher_availability (teacher_id, date, start_time, end_time, is_active)
SELECT t.id, vd.d, tm.s, tm.e, true
FROM teachers t
CROSS JOIN valid_dates vd
CROSS JOIN times tm
WHERE NOT EXISTS (
  SELECT 1 FROM teacher_availability ex
  WHERE ex.teacher_id = t.id
    AND ex.date = vd.d
    AND ex.start_time < tm.e
    AND ex.end_time > tm.s
);
