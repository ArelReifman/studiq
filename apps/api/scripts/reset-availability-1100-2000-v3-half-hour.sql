-- One-shot reset (v3): rebuild every future Sun–Thu day's availability on the
-- new 11:00–20:00 *half-hour* grid for every teacher. Same approach as v2 but
-- with 30-minute slots so students can book 1.5h, 2.5h, etc.
--
-- Slots referenced by active bookings (pending / approved / cancel_requested)
-- are preserved as-is — we don't split a booked 1-hour slot in half.

-- 1. Cancelled or rejected bookings stop holding their slot row hostage.
UPDATE lesson_bookings
SET availability_id = NULL
WHERE status IN ('cancelled', 'rejected');

-- 2. Anything in the future without an active booking reference is stale —
--    delete it so the new half-hour grid can populate cleanly.
DELETE FROM teacher_availability
WHERE date >= CURRENT_DATE
  AND id NOT IN (
    SELECT availability_id FROM lesson_bookings
    WHERE availability_id IS NOT NULL
  );

-- 3. For each Sun–Thu in the next 4 weeks, insert every missing 30-minute
--    11:00–20:00 grid slot per teacher. The overlap check skips any already
--    existing row (e.g. a 1-hour slot that survived step 2 because it has
--    an active booking — those keep their original duration).
WITH dates AS (
  SELECT generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '28 days', '1 day')::date AS d
), valid_dates AS (
  SELECT d FROM dates WHERE EXTRACT(DOW FROM d) BETWEEN 0 AND 4
), times AS (
  SELECT * FROM (VALUES
    ('11:00','11:30'),('11:30','12:00'),
    ('12:00','12:30'),('12:30','13:00'),
    ('13:00','13:30'),('13:30','14:00'),
    ('14:00','14:30'),('14:30','15:00'),
    ('15:00','15:30'),('15:30','16:00'),
    ('16:00','16:30'),('16:30','17:00'),
    ('17:00','17:30'),('17:30','18:00'),
    ('18:00','18:30'),('18:30','19:00'),
    ('19:00','19:30'),('19:30','20:00')
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
