-- Imports retain their original timestamps. Ordinary inserts still use the
-- column defaults; updates always refresh modified time and retain created time.
CREATE OR REPLACE FUNCTION public.apply_row_timestamps_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.time_created := COALESCE(NEW.time_created, CURRENT_TIMESTAMP);
    NEW.time_modified := COALESCE(NEW.time_modified, CURRENT_TIMESTAMP);
  ELSE
    NEW.time_created := OLD.time_created;
    NEW.time_modified := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;
