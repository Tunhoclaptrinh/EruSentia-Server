-- Week 5: an opaque revision invalidates cached public projections, including SQL writes.
BEGIN;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS cache_revision UUID NOT NULL DEFAULT gen_random_uuid();
CREATE OR REPLACE FUNCTION bump_template_cache_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.cache_revision := gen_random_uuid();
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS template_cache_revision ON templates;
CREATE TRIGGER template_cache_revision BEFORE UPDATE ON templates
FOR EACH ROW EXECUTE FUNCTION bump_template_cache_revision();
COMMIT;
