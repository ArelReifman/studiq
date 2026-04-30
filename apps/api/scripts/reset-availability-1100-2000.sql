-- One-shot cleanup: delete future availability slots that have NO booking
-- references, so the next page load regenerates them with the new 11:00–20:00
-- defaults. Slots that already have any booking history (pending, approved,
-- cancelled, etc.) are left alone — those represent real commitments.

DELETE FROM teacher_availability
WHERE date >= CURRENT_DATE
  AND id NOT IN (
    SELECT availability_id FROM lesson_bookings
    WHERE availability_id IS NOT NULL
  );
