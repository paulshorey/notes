import { NextResponse } from "next/server"
import { getDb } from "@lib/db-notes"

const REQUIRED_RELATIONS = [
  "public.user_workspace_v1",
  "public.workspace_note_category_v1",
  "public.workspace_note_status_v1",
  "public.workspace_note_tag_v1",
  "public.user_note_v1",
] as const

/**
 * Health Check
 * Verifies database connectivity and the minimum schema needed by the app.
 */
export async function GET() {
  try {
    const db = getDb()
    const result = await db.query<{ relation: string }>(
      `SELECT relation
       FROM unnest($1::text[]) relation
       WHERE to_regclass(relation) IS NULL`,
      [REQUIRED_RELATIONS],
    )

    if ((result.rowCount ?? 0) > 0) {
      console.error("Health check failed: Notes database schema is out of date")
      return NextResponse.json(
        {
          status: "unhealthy",
          timestamp: new Date().toISOString(),
          database: "schema_outdated",
          code: "DATABASE_SCHEMA_OUTDATED",
          retryable: false,
        },
        { status: 503 },
      )
    }

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: "connected",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("Health check failed:", message)
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        database: "disconnected",
        code: "DATABASE_UNAVAILABLE",
        retryable: true,
      },
      { status: 503 },
    )
  }
}
