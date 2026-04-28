"use client"

import { useRef, useState } from "react"
import { Button, Popup, Text } from "@gravity-ui/uikit"
import { ArrowClockwise, SidebarSimple, User } from "@phosphor-icons/react"
import type { UserSummary } from "@lib/db-marketing"
import { useNotesAppStore } from "@/stores/notesAppStore"
import type { EmbeddingMaintenanceMode } from "@/types/notes"
import styles from "./NotesHeader.module.css"

interface NotesHeaderProps {
  user: UserSummary
  notesLoading: boolean
  onRefresh: () => void
  onLogout: () => void
  embeddingMaintenancePending: EmbeddingMaintenanceMode | null
  onRunEmbeddingMaintenance: (mode: EmbeddingMaintenanceMode) => void
}

export function NotesHeader({
  user,
  notesLoading,
  onRefresh,
  onLogout,
  embeddingMaintenancePending,
  onRunEmbeddingMaintenance,
}: NotesHeaderProps) {
  const userBtnRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const setResultsListVisible = useNotesAppStore((state) => state.setResultsListVisible)

  return (
    <div className={styles.headerActions}>
      <Button
        view="flat"
        size="m"
        onClick={onRefresh}
        loading={notesLoading}
        className={styles.headerButton}
      >
        <ArrowClockwise size={18} weight="regular" className={styles.headerIcon} />
      </Button>
      <Button
        ref={userBtnRef}
        view="flat"
        size="m"
        onClick={() => setMenuOpen((v) => !v)}
        className={styles.headerButton}
      >
        <User size={18} weight="regular" className={styles.headerIcon} />
      </Button>
      <Button
        view="flat"
        size="m"
        onClick={() => setResultsListVisible(true)}
        aria-label="Show notes list"
        className={`${styles.headerButton} ${styles.mobileResultsButton}`}
      >
        <SidebarSimple size={18} weight="regular" className={styles.headerIcon} />
      </Button>
      <Popup
        anchorRef={userBtnRef}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="bottom-end"
      >
        <div className={styles.userMenu}>
          <Text variant="body-2">{user.username}</Text>
          {user.email && (
            <Text variant="caption-1" color="secondary">
              {user.email}
            </Text>
          )}
          {user.phone && (
            <Text variant="caption-1" color="secondary">
              {user.phone}
            </Text>
          )}
          <div className={styles.userMenuSection}>
            <Text variant="caption-1" color="secondary">
              Debug
            </Text>
            <Button
              view="flat-secondary"
              size="s"
              width="max"
              loading={embeddingMaintenancePending === "missing"}
              disabled={embeddingMaintenancePending !== null}
              onClick={() => {
                onRunEmbeddingMaintenance("missing")
                setMenuOpen(false)
              }}
            >
              Repair missing embeddings
            </Button>
            <Button
              view="flat-secondary"
              size="s"
              width="max"
              loading={embeddingMaintenancePending === "stale"}
              disabled={embeddingMaintenancePending !== null}
              onClick={() => {
                onRunEmbeddingMaintenance("stale")
                setMenuOpen(false)
              }}
            >
              Reindex stale embeddings
            </Button>
          </div>
          <Button
            view="flat-danger"
            size="s"
            onClick={() => {
              onLogout()
              setMenuOpen(false)
            }}
            width="max"
          >
            Sign out
          </Button>
        </div>
      </Popup>
    </div>
  )
}
