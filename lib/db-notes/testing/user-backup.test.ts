import assert from "node:assert/strict"
import { after, describe, mock, test } from "node:test"
import { parseUserBackup } from "../contracts/user-backup"
import { getDb } from "../lib/db/postgres"
import { createAnonymousUser } from "../sql/user/anonymous"
import { exportUserBackup, restoreUserBackup } from "../sql/user/backup"
import { backupFixture } from "./user-backup-fixture"

describe("backup validation", () => {
  test("validates portable data, removes foreign workspace ids, retains unknown preferences", () => {
    const file = backupFixture()
    file.preferences.notesApp!.currentWorkspaceId = 987654
    const parsed = parseUserBackup({
      ...file,
      preferences: { ...file.preferences, futureApp: { keep: true } },
      userId: 123456,
      password: "untrusted",
    })
    assert.equal(parsed.preferences.notesApp!.currentWorkspaceId, undefined)
    assert.equal(file.preferences.notesApp!.currentWorkspaceId, 987654)
    assert.equal("userId" in parsed, false)
    assert.equal("password" in parsed, false)
    assert.deepEqual((parsed.preferences as Record<string, unknown>).futureApp, { keep: true })
  })
  test("rejects malformed dates, relations, versions, duplicate labels, positions and unsafe preferences", () => {
    for (const change of [
      (b: ReturnType<typeof backupFixture>) => {
        b.version = 99
      },
      (b: ReturnType<typeof backupFixture>) => {
        b.workspaces[0]!.notes[0]!.categories = ["foreign"]
      },
      (b: ReturnType<typeof backupFixture>) => {
        b.workspaces[0]!.notes[0]!.status = "foreign"
      },
      (b: ReturnType<typeof backupFixture>) => {
        b.workspaces[0]!.notes[0]!.timeCreated = "not a date"
      },
      (b: ReturnType<typeof backupFixture>) => {
        b.workspaces[0]!.notes[0]!.timeDue = "2026-02-31T12:00:00.000Z"
      },
      (b: ReturnType<typeof backupFixture>) => {
        b.workspaces[0]!.notes[0]!.description = "\ud800"
      },
      (b: ReturnType<typeof backupFixture>) => {
        b.workspaces[0]!.statuses[0]!.position = -1
      },
      (b: ReturnType<typeof backupFixture>) => {
        b.workspaces.push(b.workspaces[0]!)
      },
      (b: ReturnType<typeof backupFixture>) => {
        b.preferences = JSON.parse('{"__proto__":{"polluted":true}}')
      },
      (b: ReturnType<typeof backupFixture>) => {
        b.preferences = JSON.parse('{"notesApp":[]}')
      },
    ]) {
      const file = backupFixture()
      change(file)
      assert.throws(() => parseUserBackup(file))
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
  })
})

const testDbUrl = process.env.DB_NOTES_TEST_URL
if (testDbUrl) {
  process.env.DB_NOTES_URL = testDbUrl
  // Two clients exercise the destination row lock, not only pool serialization.
  process.env.PG_POOL_MAX = "2"
}

describe("user backup and restore (DB)", { skip: !testDbUrl }, () => {
  const userIds: number[] = []
  const realUser = async () => {
    const user = await createAnonymousUser()
    userIds.push(user.id)
    await getDb().query(
      `UPDATE public.user_v1 SET is_anonymous=false,preferences=$2::jsonb,password='secret-hash',email='private@example.test' WHERE id=$1`,
      [
        user.id,
        JSON.stringify({ notesApp: { markdownEditorMode: "source", pasteUrlAsMarkdown: false } }),
      ],
    )
    return user.id
  }
  after(async () => {
    await getDb().query(`DELETE FROM public.user_v1 WHERE id=ANY($1::int[])`, [userIds])
    await getDb().end()
  })

  test("round trips all workspaces, unused vocabulary, relations, dates and preferences into another account", async () => {
    const sourceId = await realUser()
    const targetId = await realUser()
    const file = backupFixture()
    const side = structuredClone(file.workspaces[0]!)
    side.label = "side project"
    side.notes = [
      {
        ...side.notes[0]!,
        description: null,
        categories: [],
        status: null,
        tags: [],
        timeDue: null,
      },
    ]
    file.workspaces.push(side)
    file.activeWorkspaceLabel = side.label
    const first = await restoreUserBackup(sourceId, file)
    assert.deepEqual(first, { notesImported: 2, notesSkipped: 0 })
    const backup = await exportUserBackup(sourceId)
    assert.equal(backup.workspaces.length, 2)
    assert.equal(backup.activeWorkspaceLabel, "side project")
    assert.equal(backup.preferences.notesApp!.currentWorkspaceId, undefined)
    assert.equal(JSON.stringify(backup).includes("secret-hash"), false)
    assert.equal(JSON.stringify(backup).includes("private@example.test"), false)

    // Target already has its own colliding workspace, shared vocabulary, a
    // different status order, and a newer version of one backed-up note.
    const targetWorkspace = (
      await getDb().query<{ id: number }>(
        `SELECT id FROM public.user_workspace_v1 WHERE user_id=$1`,
        [targetId],
      )
    ).rows[0]!.id
    await getDb().query(
      `INSERT INTO public.workspace_note_category_v1(workspace_id,label) VALUES($1,'shared')`,
      [targetWorkspace],
    )
    await getDb().query(
      `INSERT INTO public.workspace_note_status_v1(workspace_id,label,position) VALUES($1,'todo',2)`,
      [targetWorkspace],
    )
    const existingNoteId = (
      await getDb().query<{ id: number }>(
        `INSERT INTO public.user_note_v1(workspace_id,description,time_created) VALUES($1,'existing account note',$2) RETURNING id`,
        [targetWorkspace, file.workspaces[0]!.notes[0]!.timeCreated],
      )
    ).rows[0]!.id
    const restored = await restoreUserBackup(targetId, backup)
    assert.deepEqual(restored, { notesImported: 2, notesSkipped: 0 })
    const targetBackup = await exportUserBackup(targetId)
    assert.equal(targetBackup.workspaces.length, 2)
    assert.equal(targetBackup.workspaces[0]!.notes.length, 2)
    const imported = targetBackup.workspaces[0]!.notes.find(
      (n) => n.description === file.workspaces[0]!.notes[0]!.description,
    )
    assert.deepEqual(imported, file.workspaces[0]!.notes[0])
    assert.deepEqual(targetBackup.workspaces[1], backup.workspaces[1])
    assert.ok(targetBackup.workspaces[0]!.categories.some((c) => c.label === "unused"))
    assert.equal(targetBackup.workspaces[0]!.statuses.find((s) => s.label === "todo")!.position, 2)
    assert.equal(targetBackup.preferences.notesApp!.pasteUrlAsMarkdown, true)
    assert.equal(targetBackup.preferences.notesApp!.markdownEditorMode, "source")
    assert.equal(
      (
        await getDb().query(`SELECT description FROM public.user_note_v1 WHERE id=$1`, [
          existingNoteId,
        ])
      ).rows[0]!.description,
      "existing account note",
    )
    assert.notEqual(
      (
        await getDb().query(
          `SELECT preferences->'notesApp'->>'currentWorkspaceId' id FROM public.user_v1 WHERE id=$1`,
          [sourceId],
        )
      ).rows[0]!.id,
      (
        await getDb().query(
          `SELECT preferences->'notesApp'->>'currentWorkspaceId' id FROM public.user_v1 WHERE id=$1`,
          [targetId],
        )
      ).rows[0]!.id,
    )
    assert.deepEqual(await restoreUserBackup(targetId, backup), {
      notesImported: 0,
      notesSkipped: 2,
    })
    assert.deepEqual(await restoreUserBackup(sourceId, backup), {
      notesImported: 0,
      notesSkipped: 2,
    })
  })

  test("preserves identical twin notes and serializes concurrent restores without duplicates", async () => {
    const id = await realUser()
    const file = backupFixture()
    file.workspaces[0]!.notes.push(structuredClone(file.workspaces[0]!.notes[0]!))
    const results = await Promise.all([restoreUserBackup(id, file), restoreUserBackup(id, file)])
    assert.deepEqual(results, [
      { notesImported: 2, notesSkipped: 0 },
      { notesImported: 0, notesSkipped: 2 },
    ])
    assert.equal((await exportUserBackup(id)).workspaces[0]!.notes.length, 2)
  })

  test("rolls back staging and preferences on a database failure and rejects anonymous targets", async () => {
    const id = await realUser()
    const before = await exportUserBackup(id)
    const usersBefore = (
      await getDb().query(
        `SELECT COUNT(*)::int count FROM public.user_v1 WHERE username LIKE 'backup-%'`,
      )
    ).rows[0]!.count
    const file = backupFixture()
    file.workspaces[0]!.notes.push({ ...file.workspaces[0]!.notes[0]!, description: "second note" })
    const client = await getDb().connect()
    const originalQuery = client.query.bind(client)
    // Force a real SQL error after staging and after destination preferences,
    // categories, and statuses have already been merged.
    const queryMock = mock.method(client, "query", async (sql: string, values?: unknown[]) => {
      if (sql.includes("SELECT $1,label,tag_embedding")) {
        return originalQuery("SELECT 1/0")
      }
      return originalQuery(sql, values)
    })
    const connectMock = mock.method(getDb(), "connect", async () => client)
    try {
      await assert.rejects(restoreUserBackup(id, file), /division by zero/)
    } finally {
      connectMock.mock.restore()
      queryMock.mock.restore()
    }
    const after = await exportUserBackup(id)
    assert.deepEqual(after.workspaces, before.workspaces)
    assert.deepEqual(after.preferences, before.preferences)
    assert.equal(
      (
        await getDb().query(
          `SELECT COUNT(*)::int count FROM public.user_v1 WHERE username LIKE 'backup-%'`,
        )
      ).rows[0]!.count,
      usersBefore,
    )
    const anon = await createAnonymousUser()
    userIds.push(anon.id)
    await assert.rejects(restoreUserBackup(anon.id, backupFixture()), /Sign in or create/)
    assert.equal((await exportUserBackup(anon.id)).workspaces[0]!.notes.length, 0)
  })

  test("imports a thousand related notes with a bounded number of database round trips", async (t) => {
    const id = await realUser()
    const file = backupFixture()
    const template = file.workspaces[0]!.notes[0]!
    file.workspaces[0]!.notes = Array.from({ length: 1000 }, (_, index) => ({
      ...template,
      description: `bulk note ${index}`,
    }))
    const client = await getDb().connect()
    const originalQuery = client.query.bind(client)
    let queries = 0
    const queryMock = mock.method(client, "query", async (sql: string, values?: unknown[]) => {
      queries++
      return originalQuery(sql, values)
    })
    const connectMock = mock.method(getDb(), "connect", async () => client)
    try {
      assert.deepEqual(await restoreUserBackup(id, file), { notesImported: 1000, notesSkipped: 0 })
    } finally {
      connectMock.mock.restore()
      queryMock.mock.restore()
    }
    assert.ok(queries < 100, `A single-workspace restore used ${queries} round trips`)
    t.diagnostic(`Restored 1,000 related notes with ${queries} database round trips.`)
    const notes = (await exportUserBackup(id)).workspaces[0]!.notes
    assert.equal(notes.length, 1000)
    for (const note of notes) {
      assert.deepEqual(note.categories, template.categories)
      assert.equal(note.status, template.status)
      assert.deepEqual(note.tags, template.tags)
    }
  })

  test("timestamp trigger preserves inserts but updates refresh modified time and retain creation", async () => {
    const id = await realUser()
    await restoreUserBackup(id, backupFixture())
    const note = (
      await getDb().query<{ id: number }>(
        `SELECT n.id FROM public.user_note_v1 n JOIN public.user_workspace_v1 w ON w.id=n.workspace_id WHERE w.user_id=$1`,
        [id],
      )
    ).rows[0]!
    await getDb().query(
      `UPDATE public.user_note_v1 SET description='edited',time_created='1990-01-01',time_modified='1990-01-01' WHERE id=$1`,
      [note.id],
    )
    const result = (await exportUserBackup(id)).workspaces[0]!.notes[0]!
    assert.equal(result.timeCreated, backupFixture().workspaces[0]!.notes[0]!.timeCreated)
    assert.ok(
      Date.parse(result.timeModified) >
        Date.parse(backupFixture().workspaces[0]!.notes[0]!.timeModified),
    )
  })
})
