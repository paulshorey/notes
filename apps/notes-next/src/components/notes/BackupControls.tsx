"use client"

import { useState } from "react"
import { Button, Text } from "@gravity-ui/uikit"
import { Modal, Stack, Alert } from "@mantine/core"
import type { RestoreBackupResponse, UserBackup } from "@lib/db-notes/contracts/notes-app"
import { parseUserBackup, USER_BACKUP_MAX_BYTES } from "@lib/db-notes/contracts/user-backup"
import { getErrorMessage } from "@/lib/api"
import { useNotesAppStore } from "@/stores/notesAppStore"
import styles from "./NotesHeader.module.css"

export function BackupControls({
  isAnonymous,
  onDownload,
  onOpenRestore,
}: {
  isAnonymous: boolean
  onDownload: () => Promise<void>
  onOpenRestore: () => void
}) {
  const pending = useNotesAppStore((s) => s.backupOperation)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  return (
    <div className={styles.userMenuSection}>
      <Text variant="caption-1" color="secondary">
        Your data
      </Text>
      <Button
        view="flat-secondary"
        size="s"
        width="max"
        disabled={pending !== null}
        loading={pending === "download"}
        onClick={() => {
          setDownloadError(null)
          void onDownload().catch((e) => setDownloadError(getErrorMessage(e)))
        }}
      >
        Download backup
      </Button>
      <Button
        view="flat-secondary"
        size="s"
        width="max"
        disabled={pending !== null || isAnonymous}
        onClick={onOpenRestore}
      >
        Restore backup…
      </Button>
      {isAnonymous && (
        <Text variant="caption-1" color="secondary">
          Sign in or create an account to restore a backup.
        </Text>
      )}
      {downloadError && (
        <Text color="danger" role="alert">
          {downloadError}
        </Text>
      )}
    </div>
  )
}

// Keep this outside the account Popup: clicking a portaled modal closes the
// popup, which would otherwise unmount the restore flow during file selection.
export function BackupRestoreModal({
  opened,
  onClose,
  onRestore,
}: {
  opened: boolean
  onClose: () => void
  onRestore: (file: File) => Promise<RestoreBackupResponse>
}) {
  const pending = useNotesAppStore((s) => s.backupOperation)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<UserBackup | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RestoreBackupResponse | null>(null)
  const busy = pending !== null || reading
  const noteCount =
    preview?.workspaces.reduce((count, workspace) => count + workspace.notes.length, 0) ?? 0
  const selectFile = async (next: File | null) => {
    setFile(null)
    setPreview(null)
    setResult(null)
    setError(null)
    if (!next) return
    setReading(true)
    try {
      if (next.size > USER_BACKUP_MAX_BYTES)
        throw new Error("Choose a backup file of 50 MB or smaller.")
      const backup = parseUserBackup(JSON.parse(await next.text()))
      setPreview(backup)
      setFile(next)
    } catch (e) {
      setError(
        e instanceof SyntaxError ? "The selected file is not valid JSON." : getErrorMessage(e),
      )
    } finally {
      setReading(false)
    }
  }
  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!busy) onClose()
      }}
      title="Restore your backup"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      withCloseButton={!busy}
    >
      <Stack gap="md">
        <Text>
          Your backup will be merged into this account. Existing notes are kept, matching workspaces
          and labels are combined, and exact copies are skipped. Backup preferences replace matching
          settings.
        </Text>
        <Text variant="caption-1" color="secondary">
          Backups contain private note content. Store them somewhere safe. Maximum file size: 50 MB.
        </Text>
        <input
          type="file"
          accept=".json,application/json"
          aria-label="Backup file"
          disabled={busy}
          onChange={(e) => {
            void selectFile(e.target.files?.[0] ?? null)
          }}
        />
        {reading && <Text role="status">Reading backup…</Text>}
        {preview && (
          <Text>
            {preview.workspaces.length} workspace{preview.workspaces.length === 1 ? "" : "s"},{" "}
            {noteCount} note{noteCount === 1 ? "" : "s"}. Exported{" "}
            {new Date(preview.exportedAt).toLocaleString()}.
          </Text>
        )}
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {result ? (
          <>
            <Alert color="green" role="status">
              Restored {result.notesImported} note{result.notesImported === 1 ? "" : "s"}; skipped{" "}
              {result.notesSkipped} exact {result.notesSkipped === 1 ? "copy" : "copies"}.
            </Alert>
            <Text variant="caption-1">
              To include restored notes in semantic search, use “Repair missing embeddings” in the
              account menu.
            </Text>
            <Button view="action" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <Button
            view="action"
            disabled={!file || busy}
            loading={pending === "restore"}
            onClick={() => {
              if (!file) return
              setError(null)
              void onRestore(file)
                .then(setResult)
                .catch((e) => setError(getErrorMessage(e)))
            }}
          >
            Merge backup into this account
          </Button>
        )}
      </Stack>
    </Modal>
  )
}
