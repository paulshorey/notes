import process from "node:process";
import { Client } from "pg";

if (!process.env.MARKETING_DB_URL) {
  throw new Error("MARKETING_DB_URL is required");
}

const client = new Client({ connectionString: process.env.MARKETING_DB_URL });
await client.connect();

const result = await client.query(`
  DELETE FROM public.user_v1 u
  WHERE u.is_anonymous = true
    AND u.time_created < now() - interval '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.user_note_v1 n
      WHERE n.user_id = u.id AND n.time_modified > now() - interval '30 days'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_note_category_v1 c
      WHERE c.user_id = u.id AND c.time_modified > now() - interval '30 days'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_note_tag_v1 t
      WHERE t.user_id = u.id AND t.time_modified > now() - interval '30 days'
    )
`);

console.log(`Deleted ${result.rowCount} abandoned anonymous user(s).`);
await client.end();
