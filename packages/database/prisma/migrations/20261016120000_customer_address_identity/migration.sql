-- Schema-only rollout: legacy address records are not modified or removed.
-- NULL legacy keys let this migration succeed with pre-existing duplicates.
BEGIN;
ALTER TABLE customer_addresses ADD COLUMN canonical_key TEXT;

CREATE FUNCTION wings4u_address_key(street TEXT, town TEXT, postal TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT jsonb_build_array(
    lower(trim(regexp_replace(normalize(street, NFKC), '[[:space:]]+', ' ', 'g'))),
    lower(trim(regexp_replace(normalize(town, NFKC), '[[:space:]]+', ' ', 'g'))),
    lower(regexp_replace(normalize(postal, NFKC), '[[:space:]]+', '', 'g'))
  )::text
$$;

CREATE UNIQUE INDEX uq_customer_addresses_canonical ON customer_addresses(user_id, canonical_key);
CREATE INDEX idx_customer_addresses_identity_lookup
  ON customer_addresses(user_id, wings4u_address_key(line1, city, postal_code));

CREATE FUNCTION wings4u_guard_customer_address() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity_key TEXT;
DECLARE identity_changed BOOLEAN;
DECLARE has_duplicate BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'Saved address ownership cannot be changed' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 84542));
  identity_key := wings4u_address_key(NEW.line1, NEW.city, NEW.postal_code);
  identity_changed := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN
    identity_changed := identity_key IS DISTINCT FROM wings4u_address_key(OLD.line1, OLD.city, OLD.postal_code);
  END IF;
  SELECT EXISTS(SELECT 1 FROM customer_addresses a
    WHERE a.user_id = NEW.user_id AND a.id <> NEW.id
      AND wings4u_address_key(a.line1, a.city, a.postal_code) = identity_key)
    INTO has_duplicate;
  IF has_duplicate AND identity_changed THEN
    RAISE EXCEPTION 'This address is already saved.' USING ERRCODE = '23505', CONSTRAINT = 'uq_customer_addresses_canonical';
  END IF;
  IF has_duplicate THEN
    -- Labels/defaults on legacy duplicates remain editable without adding duplicates.
    NEW.canonical_key := OLD.canonical_key;
  ELSE
    NEW.canonical_key := identity_key;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_customer_address_identity BEFORE INSERT OR UPDATE ON customer_addresses
  FOR EACH ROW EXECUTE FUNCTION wings4u_guard_customer_address();
COMMIT;
