"use client"

import { Notification } from "@mantine/core"
import styles from "./FeedbackNotifications.module.css"

interface FeedbackNotificationsProps {
  statusMessage: string | null
  errorMessage: string | null
  searchErrorMessage: string | null
  onDismissStatus: () => void
  onDismissError: () => void
  onDismissSearchError: () => void
}

export function FeedbackNotifications({
  statusMessage,
  errorMessage,
  searchErrorMessage,
  onDismissStatus,
  onDismissError,
  onDismissSearchError,
}: FeedbackNotificationsProps) {
  if (!statusMessage && !errorMessage && !searchErrorMessage) {
    return null
  }

  return (
    <div className={styles.feedback}>
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
