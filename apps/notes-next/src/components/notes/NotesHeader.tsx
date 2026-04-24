"use client"

import { useRef, useState } from "react"
import { Button, Icon, Popup, Text } from "@gravity-ui/uikit"
import { ArrowsRotateLeft, Person } from "@gravity-ui/icons"
import type { UserSummary } from "@lib/db-marketing"
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

  return (
    <div className={styles.headerActions}>
        <Button view="flat" size="m" onClick={onRefresh} loading={notesLoading}>
          <Icon data={ArrowsRotateLeft} size={16} />
        </Button>
        <Button
          ref={userBtnRef}
          view="flat"
          size="m"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Icon data={Person} size={16} />
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
