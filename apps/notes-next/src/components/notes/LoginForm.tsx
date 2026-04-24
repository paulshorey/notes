"use client"

import { Notification } from "@mantine/core"
import { Button, Text, TextInput } from "@gravity-ui/uikit"
import type { FormEvent } from "react"
import styles from "./NotesApp.module.css"

interface LoginFormProps {
  identifier: string
  onIdentifierChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pending: boolean
  errorMessage: string | null
  onDismissError: () => void
}

export function LoginForm({
  identifier,
  onIdentifierChange,
  onSubmit,
  pending,
  errorMessage,
  onDismissError,
}: LoginFormProps) {
  return (
    <div className={styles.loginPage}>
      <form className={styles.loginForm} onSubmit={onSubmit}>
        <Text variant="header-1">Notes</Text>
        <TextInput
          size="l"
          placeholder="Username, email, or phone"
          value={identifier}
          onUpdate={onIdentifierChange}
          autoComplete="username"
        />
        <Button view="action" size="l" type="submit" loading={pending} width="max">
          Sign in
        </Button>
        {errorMessage && (
          <Notification
            className={styles.feedbackNotification}
            color="red"
            radius="md"
            title="Unable to sign in"
            withCloseButton
            onClose={onDismissError}
          >
            {errorMessage}
          </Notification>
        )}
      </form>
    </div>
  )
}
