-- Moving a row to another owner is not an edit.
--
-- Every update refreshes time_modified. A transaction that re-homes rows, such as
-- merging a visitor's items into an account, sets app.keep_time_modified to 'on' for
-- those statements so the rows keep the modification time their content had.

CREATE OR REPLACE FUNCTION public.apply_row_timestamps_v1() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.time_created := COALESCE(NEW.time_created, CURRENT_TIMESTAMP);
    NEW.time_modified := COALESCE(NEW.time_modified, CURRENT_TIMESTAMP);
  ELSE
    NEW.time_created := OLD.time_created;
    IF current_setting('app.keep_time_modified', true) = 'on' THEN
      NEW.time_modified := OLD.time_modified;
    ELSE
      NEW.time_modified := CURRENT_TIMESTAMP;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
