"use client"

import type { FormEvent, KeyboardEvent } from "react"
import { useEffect, useRef, useState } from "react"
import { Button, Checkbox, Popup, Spin, Text, TextInput } from "@gravity-ui/uikit"
import { Notification } from "@mantine/core"
import {
  Check,
  Cloud,
  MagnifyingGlass,
  SidebarSimple,
  User,
  WarningCircle,
  X,
} from "@phosphor-icons/react"
import type { UserSummary } from "@lib/db-notes"
import { toLowercaseInput } from "@/lib/strings"
import { useNotesAppStore } from "@/stores/notesAppStore"
import type { EmbeddingMaintenanceMode, NoteSaveStatus } from "@/types/notes"
import styles from "./NotesHeader.module.css"

const SAVE_STATUS_LABELS: Record<NoteSaveStatus, string> = {
  idle: "",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  saved: "All changes saved",
  error: "Could not save — retrying",
}

function SaveStatusIndicator() {
  const saveStatus = useNotesAppStore((state) => state.noteSaveStatus)

  if (saveStatus === "idle") {
    return null
  }

  const label = SAVE_STATUS_LABELS[saveStatus]

  return (
    <span
      className={styles.saveIndicator}
      data-status={saveStatus}
      role="status"
      aria-live="polite"
      title={label}
      aria-label={label}
    >
      {saveStatus === "saving" && <Spin size="xs" />}
      {saveStatus === "saved" && <Check size={14} weight="bold" aria-hidden />}
      {saveStatus === "unsaved" && <Cloud size={15} weight="regular" aria-hidden />}
      {saveStatus === "error" && <WarningCircle size={15} weight="bold" aria-hidden />}
    </span>
  )
}

export interface SignupFields {
  username: string
  email: string
  password: string
}

interface NotesHeaderProps {
  user: UserSummary
  isAnonymous: boolean
  resultsListVisible: boolean
  pasteUrlAsMarkdown: boolean
  onPasteUrlAsMarkdownChange: (enabled: boolean) => void
  onAddNote: () => void
  onLogout: () => void
  embeddingMaintenancePending: EmbeddingMaintenanceMode | null
  onRunEmbeddingMaintenance: (mode: EmbeddingMaintenanceMode) => void
  identifier: string
  password: string
  onIdentifierChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onLoginSubmit: (event: FormEvent<HTMLFormElement>) => Promise<boolean>
  onSignupSubmit: (fields: SignupFields) => Promise<boolean>
  authPending: boolean
  loginErrorMessage: string | null
  onDismissLoginError: () => void
}

export function NotesHeader({
  user,
  isAnonymous,
  resultsListVisible,
  pasteUrlAsMarkdown,
  onPasteUrlAsMarkdownChange,
  onAddNote,
  onLogout,
  embeddingMaintenancePending,
  onRunEmbeddingMaintenance,
  identifier,
  password,
  onIdentifierChange,
  onPasswordChange,
  onLoginSubmit,
  onSignupSubmit,
  authPending,
  loginErrorMessage,
  onDismissLoginError,
}: NotesHeaderProps) {
  const userBtnRef = useRef<HTMLButtonElement>(null)
  const searchInputControlRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin")
  const [signupUsername, setSignupUsername] = useState("")
  const [signupEmail, setSignupEmail] = useState("")
  const [signupPassword, setSignupPassword] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const searchQuery = useNotesAppStore((state) => state.searchQuery)
  const setSearchQuery = useNotesAppStore((state) => state.setSearchQuery)
  const setResultsListVisible = useNotesAppStore((state) => state.setResultsListVisible)
  const trimmedSearchQuery = searchQuery.trim()
  const searchExpanded = searchOpen || trimmedSearchQuery !== ""

  useEffect(() => {
    if (!searchExpanded) return
    const frameId = window.requestAnimationFrame(() => {
      searchInputControlRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [searchExpanded])

  const resetAuthPopupState = () => {
    setAuthMode("signin")
    setSignupUsername("")
    setSignupEmail("")
    setSignupPassword("")
  }

  const closeAuthMenu = () => {
    setMenuOpen(false)
    resetAuthPopupState()
  }

  const handleSigninSubmit = async (event: FormEvent<HTMLFormElement>) => {
    const success = await onLoginSubmit(event)
    if (success) {
      closeAuthMenu()
    }
  }

  const handleSignupFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const success = await onSignupSubmit({
      username: signupUsername,
      email: signupEmail,
      password: signupPassword,
    })
    if (success) {
      closeAuthMenu()
    }
  }

  const openSearch = () => {
    setSearchOpen(true)
  }

  const collapseSearchIfEmpty = () => {
    if (trimmedSearchQuery === "") {
      setSearchOpen(false)
    }
  }

  const clearSearch = () => {
    setSearchQuery("")
    setSearchOpen(true)
    window.requestAnimationFrame(() => {
      searchInputControlRef.current?.focus()
    })
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    if (trimmedSearchQuery !== "") {
      setSearchQuery("")
      return
    }
    setSearchOpen(false)
  }

  const pasteUrlPreference = (
    <Checkbox
      size="m"
      checked={pasteUrlAsMarkdown}
      onUpdate={onPasteUrlAsMarkdownChange}
      className={styles.userMenuPreference}
    >
      Paste URLs as markdown links
    </Checkbox>
  )

  return (
    <div className={styles.headerActions}>
      <div className={styles.headerBrand}>
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
        <SaveStatusIndicator />
      </div>

      <span className={styles.headerButtons}>
        <div
          className={`${styles.headerSearch} ${searchExpanded ? styles.headerSearchExpanded : ""}`}
        >
          <Button
            view="flat"
            size="m"
            onClick={openSearch}
            aria-label="Open search"
            title="AI Search"
            tabIndex={searchExpanded ? -1 : 0}
            aria-hidden={searchExpanded}
            className={`${styles.headerButton} ${styles.searchToggleButton}`}
          >
            <MagnifyingGlass size={18} weight="regular" className={styles.headerIcon} />
          </Button>
          <div className={styles.searchField} aria-hidden={!searchExpanded}>
            <TextInput
              size="l"
              placeholder="AI Search"
              value={searchQuery}
              onUpdate={(value) => setSearchQuery(toLowercaseInput(value))}
              onBlur={collapseSearchIfEmpty}
              onKeyDown={handleSearchKeyDown}
              controlRef={searchInputControlRef}
              startContent={
                <span className={styles.searchLeadingIcon} aria-hidden>
                  <MagnifyingGlass size={18} weight="regular" className={styles.headerIcon} />
                </span>
              }
              endContent={
                trimmedSearchQuery !== "" ? (
                  <button
                    type="button"
                    className={styles.searchClearButton}
                    aria-label="Clear search"
                    title="Clear search"
                    tabIndex={searchExpanded ? 0 : -1}
                    onMouseDown={(event) => {
                      // Keep focus in the field; avoid blur-collapse before clear.
                      event.preventDefault()
                    }}
                    onClick={clearSearch}
                  >
                    <X size={14} weight="bold" />
                  </button>
                ) : undefined
              }
              className={styles.searchInput}
              controlProps={{
                "aria-label": "AI Search",
                tabIndex: searchExpanded ? 0 : -1,
              }}
            />
          </div>
        </div>

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
          onClick={() => setResultsListVisible(!resultsListVisible)}
          aria-label={resultsListVisible ? "Hide notes list" : "Show notes list"}
          aria-pressed={resultsListVisible}
          title={resultsListVisible ? "Hide notes list" : "Show notes list"}
          className={`${styles.headerButton} ${styles.resultsToggleButton}`}
        >
          <SidebarSimple size={18} weight="regular" className={styles.headerIcon} />
        </Button>
      </span>
      <Popup anchorRef={userBtnRef} open={menuOpen} onClose={closeAuthMenu} placement="bottom-end">
        <div className={styles.userMenu}>
          {pasteUrlPreference}
          {isAnonymous ? (
            authMode === "signin" ? (
              <form
                onSubmit={(event) => {
                  void handleSigninSubmit(event)
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
                <Button
                  type="button"
                  view="flat"
                  size="m"
                  width="max"
                  disabled={authPending}
                  onClick={(event) => {
                    event.preventDefault()
                    setAuthMode("signup")
                  }}
                >
                  Create account
                </Button>
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
              <form
                onSubmit={(event) => {
                  void handleSignupFormSubmit(event)
                }}
                className={styles.loginFormInPopup}
              >
                <Text variant="body-2">Create an account to keep your notes</Text>
                <TextInput
                  size="m"
                  placeholder="Username"
                  value={signupUsername}
                  onUpdate={setSignupUsername}
                  autoComplete="username"
                />
                <TextInput
                  size="m"
                  type="email"
                  placeholder="Email (optional)"
                  value={signupEmail}
                  onUpdate={setSignupEmail}
                  autoComplete="email"
                />
                <TextInput
                  size="m"
                  type="password"
                  placeholder="Password (8+ characters)"
                  value={signupPassword}
                  onUpdate={setSignupPassword}
                  autoComplete="new-password"
                />
                <Button view="action" size="m" type="submit" loading={authPending} width="max">
                  Create account
                </Button>
                <Button
                  type="button"
                  view="flat"
                  size="m"
                  width="max"
                  disabled={authPending}
                  onClick={(event) => {
                    event.preventDefault()
                    setAuthMode("signin")
                  }}
                >
                  I already have an account
                </Button>
                {loginErrorMessage && (
                  <Notification
                    color="red"
                    radius="md"
                    title="Unable to create account"
                    withCloseButton
                    onClose={onDismissLoginError}
                  >
                    {loginErrorMessage}
                  </Notification>
                )}
              </form>
            )
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
