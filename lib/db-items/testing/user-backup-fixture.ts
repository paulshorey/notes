import type { UserBackup } from "../contracts/items-app"
import { USER_BACKUP_FORMAT, USER_BACKUP_VERSION } from "../contracts/user-backup"

const dates = {
  timeCreated: "2020-01-02T03:04:05.000Z",
  timeModified: "2021-02-03T04:05:06.000Z",
}

export const backupFixture = (): UserBackup => ({
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
        { label: "shared", ...dates, subcategories: [{ label: "ideas", ...dates }] },
        { label: "unused", ...dates, subcategories: [] },
      ],
      statuses: [{ label: "todo", position: 5, ...dates }],
      tags: [{ label: "important", ...dates }],
      items: [
        {
          description: "# Backed up\n\nText with 日本語 and emoji 🌱",
          category: "shared",
          subcategory: "ideas",
          status: "todo",
          tags: ["important"],
          timeDue: "2027-01-02T03:04:05.000Z",
          timeRemind: null,
          ...dates,
        },
      ],
    },
  ],
})

/** A version 2 file: flat categories and several categories per item. */
export const flatCategoryBackupFixture = () => ({
  format: USER_BACKUP_FORMAT,
  version: 2,
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
      items: [
        {
          description: "# Backed up\n\nText with 日本語 and emoji 🌱",
          categories: ["shared"] as string[],
          status: "todo",
          tags: ["important"],
          timeDue: "2027-01-02T03:04:05.000Z",
          timeRemind: null,
          ...dates,
        },
      ],
    },
  ],
})

/** What a version 1 or 2 file becomes: one category per item and no subcategories. */
export const upgradedFlatCategoryBackup = (): UserBackup => {
  const current = backupFixture()
  for (const workspace of current.workspaces) {
    for (const category of workspace.categories) category.subcategories = []
    for (const item of workspace.items) item.subcategory = null
  }
  return current
}
