"use client"

import { Notification } from "@mantine/core"
import styles from "./FeedbackNotifications.module.css"

interface FeedbackNotificationsProps {
  saveConflictUid: string | null
  onDismissConflict: () => void
  statusMessage: string | null
  errorMessage: string | null
  searchErrorMessage: string | null
  onDismissStatus: () => void
  onDismissError: () => void
  onDismissSearchError: () => void
}

export function FeedbackNotifications({
  saveConflictUid,
  onDismissConflict,
  statusMessage,
  errorMessage,
  searchErrorMessage,
  onDismissStatus,
  onDismissError,
  onDismissSearchError,
}: FeedbackNotificationsProps) {
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
          <a href={`?item=${saveConflictUid}`} target="_blank" rel="noopener noreferrer">
            Open the current version in a new tab
          </a>{" "}
          to compare your edits.
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
