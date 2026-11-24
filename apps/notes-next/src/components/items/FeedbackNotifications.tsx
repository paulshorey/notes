"use client"

import { Notification } from "@mantine/core"
import { useState } from "react"
import styles from "./FeedbackNotifications.module.css"

interface FeedbackNotificationsProps {
  saveConflictUid: string | null
  /** The text stored for the conflicting item, as the server answered it. */
  saveConflictText: string | null
  onDismissConflict: () => void
  onKeepConflictingEdits: (uid: string) => void
  statusMessage: string | null
  errorMessage: string | null
  searchErrorMessage: string | null
  onDismissStatus: () => void
  onDismissError: () => void
  onDismissSearchError: () => void
}

export function FeedbackNotifications({
  saveConflictUid,
  saveConflictText,
  onDismissConflict,
  onKeepConflictingEdits,
  statusMessage,
  errorMessage,
  searchErrorMessage,
  onDismissStatus,
  onDismissError,
  onDismissSearchError,
}: FeedbackNotificationsProps) {
  const [showsSavedText, setShowsSavedText] = useState(false)

  if (!saveConflictUid && !statusMessage && !errorMessage && !searchErrorMessage) {
    return null
  }

  return (
    <div className={styles.feedback}>
      {saveConflictUid && (
        <Notification
          className={styles.feedbackNotification}
          color="orange"
          title="Your changes are still in this tab"
          withCloseButton
          onClose={onDismissConflict}
        >
          The saved item changed.{" "}
          <button
            type="button"
            className={styles.feedbackAction}
            onClick={() => setShowsSavedText((shown) => !shown)}
          >
            {showsSavedText ? "Hide the saved version" : "Show the saved version"}
          </button>{" "}
          to compare your edits, or{" "}
          <button
            type="button"
            className={styles.feedbackAction}
            onClick={() => onKeepConflictingEdits(saveConflictUid)}
          >
            save your version over it
          </button>
          .
          {showsSavedText && (
            <pre className={styles.savedText}>{saveConflictText?.trim() || "(no text)"}</pre>
          )}
        </Notification>
      )}
      {statusMessage && (
        <Notification
          className={styles.feedbackNotification}
          color="teal"
          radius="md"
          title="Done"
          withCloseButton
          onClose={onDismissStatus}
        >
          {statusMessage}
        </Notification>
      )}
      {errorMessage && (
        <Notification
          className={styles.feedbackNotification}
          color="red"
          radius="md"
          title="Something went wrong"
          withCloseButton
          onClose={onDismissError}
        >
          {errorMessage}
        </Notification>
      )}
      {searchErrorMessage && (
        <Notification
          className={styles.feedbackNotification}
          color="red"
          radius="md"
          title="Search unavailable"
          withCloseButton
          onClose={onDismissSearchError}
        >
          {searchErrorMessage}
        </Notification>
      )}
    </div>
  )
}
