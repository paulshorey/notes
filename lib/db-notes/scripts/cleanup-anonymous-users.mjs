import process from "node:process"
import { Client } from "pg"

if (!process.env.DB_NOTES_URL) {
  throw new Error("DB_NOTES_URL is required")
}

const client = new Client({ connectionString: process.env.DB_NOTES_URL })
await client.connect()

const result = await client.query(`
  DELETE FROM public.user_v1 u
  WHERE u.is_anonymous = true
    AND u.time_created < now() - interval '30 days'
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_workspace_v1 w
      JOIN public.user_note_v1 n ON n.workspace_id = w.id
      WHERE w.user_id = u.id AND n.time_modified > now() - interval '30 days'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_workspace_v1 w
      JOIN public.workspace_note_category_v1 c ON c.workspace_id = w.id
      WHERE w.user_id = u.id AND c.time_modified > now() - interval '30 days'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_workspace_v1 w
      JOIN public.workspace_note_status_v1 s ON s.workspace_id = w.id
      WHERE w.user_id = u.id AND s.time_modified > now() - interval '30 days'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_workspace_v1 w
      JOIN public.workspace_note_tag_v1 t ON t.workspace_id = w.id
      WHERE w.user_id = u.id AND t.time_modified > now() - interval '30 days'
    )
`)

console.log(`Deleted ${result.rowCount} abandoned anonymous user(s).`)
await client.end()
