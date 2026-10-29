-- Explicit operator approval required on production. Preserve all financial and job records.
BEGIN;
SELECT pg_advisory_xact_lock(190163,2);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM iff_records WHERE kind='job' AND data->>'status' IN ('queued','running','ready','stopping','uncertain','recovery_required') AND COALESCE(data->>'cloudStopped','false')!='true') THEN
  RAISE EXCEPTION 'Stop and reconcile existing resources before migration 002';
 END IF;
END $$;
DROP INDEX IF EXISTS iff_one_live_gpu;
CREATE UNIQUE INDEX iff_one_live_gpu ON iff_records((COALESCE(data->>'engineSlotId','legacy')))
 WHERE kind='job' AND data->>'action' IN ('start','generate') AND data->>'attachedEngineId' IS NULL
 AND data->>'status' IN ('queued','running','ready','stopping','uncertain','recovery_required')
 AND COALESCE(data->>'cloudStopped','false')!='true';
CREATE UNIQUE INDEX IF NOT EXISTS iff_one_live_rental_slot ON iff_records((data->>'engineSlotId'))
 WHERE kind='rental' AND data->>'state'!='closed';
CREATE UNIQUE INDEX IF NOT EXISTS iff_one_live_rental_customer ON iff_records((data->>'customerId'))
 WHERE kind='rental' AND data->>'state'!='closed';
INSERT INTO iff_migrations(version) VALUES('002') ON CONFLICT DO NOTHING;
COMMIT;
