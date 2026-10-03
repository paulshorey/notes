import type { UserBackup } from "../contracts/notes-app"
import { USER_BACKUP_FORMAT, USER_BACKUP_VERSION } from "../contracts/user-backup"

export const backupFixture = (): UserBackup => {
  const dates = {
    timeCreated: "2020-01-02T03:04:05.000Z",
    timeModified: "2021-02-03T04:05:06.000Z",
  }
  return {
    format: USER_BACKUP_FORMAT,
    version: USER_BACKUP_VERSION,
    exportedAt: "2026-10-03T12:00:00.000Z",
    preferences: { notesApp: { pasteUrlAsMarkdown: true } },
    activeWorkspaceLabel: "personal",
    workspaces: [
      {
        label: "personal",
        ...dates,
        categories: [
          { label: "shared", ...dates },
          { label: "unused", ...dates },
        ],
        statuses: [{ label: "todo", position: 5, ...dates }],
        tags: [{ label: "important", ...dates }],
        notes: [
          {
            description: "# Backed up\n\nText with 日本語 and emoji 🌱",
            categories: ["shared"],
            status: "todo",
            tags: ["important"],
            timeDue: "2027-01-02T03:04:05.000Z",
            timeRemind: null,
            ...dates,
          },
        ],
      },
    ],
  }
}
