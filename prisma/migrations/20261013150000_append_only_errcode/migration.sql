-- Raise the append-only violation as a plain exception (SQLSTATE P0001) so the message
-- "AEGIS: table … is append-only" reaches the application instead of being mapped by the
-- client to a misleading foreign-key error.
CREATE OR REPLACE FUNCTION aegis_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AEGIS: table % is append-only (% rejected)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
