"use client"

import type { FormEvent } from "react"
import { useRef, useState } from "react"
import { Button, Popup, Text, TextInput } from "@gravity-ui/uikit"
import { Notification } from "@mantine/core"
import { Plus, SidebarSimple, User } from "@phosphor-icons/react"
import type { UserSummary } from "@lib/db-marketing"
import { useNotesAppStore } from "@/stores/notesAppStore"
import type { EmbeddingMaintenanceMode } from "@/types/notes"
import styles from "./NotesHeader.module.css"

const SOCIAL_PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "facebook", label: "Facebook" },
] as const

interface NotesHeaderProps {
  user: UserSummary
  isAnonymous: boolean
  resultsListVisible: boolean
  onAddNote: () => void
  onLogout: () => void
  embeddingMaintenancePending: EmbeddingMaintenanceMode | null
  onRunEmbeddingMaintenance: (mode: EmbeddingMaintenanceMode) => void
  identifier: string
  password: string
  onIdentifierChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onLoginSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSocialSignIn: (provider: string) => void
  authPending: boolean
  loginErrorMessage: string | null
  onDismissLoginError: () => void
}

export function NotesHeader({
  user,
  isAnonymous,
  resultsListVisible,
  onAddNote,
  onLogout,
  embeddingMaintenancePending,
  onRunEmbeddingMaintenance,
  identifier,
  password,
  onIdentifierChange,
  onPasswordChange,
  onLoginSubmit,
  onSocialSignIn,
  authPending,
  loginErrorMessage,
  onDismissLoginError,
}: NotesHeaderProps) {
  const userBtnRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const setResultsListVisible = useNotesAppStore((state) => state.setResultsListVisible)
  const resultsButtonClassName = `${styles.headerButton} ${styles.mobileResultsButton} ${
    resultsListVisible ? styles.mobileResultsButtonHiddenDesktop : ""
  }`

  return (
    <div className={styles.headerActions}>
      <div className={styles.headerBrand}>
        <button
          type="button"
          className={styles.addNoteButton}
          onClick={onAddNote}
          aria-label="Add new note"
        >
          <Plus size={18} weight="bold" aria-hidden />
        </button>
        <span
          className={styles.headerLogo}
          onClick={onAddNote}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              onAddNote()
            }
          }}
          role="button"
          tabIndex={0}
        >
          jot.new
        </span>
      </div>
      <span className={styles.headerButtons}>
        <Button
          ref={userBtnRef}
          view="flat"
          size="m"
          onClick={() => setMenuOpen((v) => !v)}
          className={styles.headerButton + " " + styles.headerButtonUser}
        >
          <User size={18} weight="regular" className={styles.headerIcon} />
        </Button>

        <Button
          view="flat"
          size="m"
          onClick={() => setResultsListVisible(true)}
          aria-label="Show notes list"
          className={resultsButtonClassName}
        >
          <SidebarSimple size={18} weight="regular" className={styles.headerIcon} />
        </Button>
      </span>
      <Popup
        anchorRef={userBtnRef}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="bottom-end"
      >
        <div className={styles.userMenu}>
          {isAnonymous ? (
            <form
              onSubmit={(e) => {
                onLoginSubmit(e)
                setMenuOpen(false)
              }}
              className={styles.loginFormInPopup}
            >
              <Text variant="body-2">Sign in to keep your notes</Text>
              <TextInput
                size="m"
                placeholder="Username, email, or phone"
                value={identifier}
                onUpdate={onIdentifierChange}
                autoComplete="username"
              />
              <TextInput
                size="m"
                type="password"
                placeholder="Password"
                value={password}
                onUpdate={onPasswordChange}
                autoComplete="current-password"
              />
              <Button view="action" size="m" type="submit" loading={authPending} width="max">
                Sign in
              </Button>
              {SOCIAL_PROVIDERS.map((provider) => (
                <Button
                  key={provider.id}
                  view="outlined"
                  size="m"
                  width="max"
                  disabled={authPending}
                  onClick={() => {
                    onSocialSignIn(provider.id)
                    setMenuOpen(false)
                  }}
                >
                  Continue with {provider.label}
                </Button>
              ))}
              {loginErrorMessage && (
                <Notification
                  color="red"
                  radius="md"
                  title="Unable to sign in"
                  withCloseButton
                  onClose={onDismissLoginError}
                >
                  {loginErrorMessage}
                </Notification>
              )}
            </form>
          ) : (
            <>
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
            </>
          )}
        </div>
      </Popup>
    </div>
  )
}
