"use client"

import { Notification } from "@mantine/core"
import { Button, Text, TextInput } from "@gravity-ui/uikit"
import type { FormEvent } from "react"
import styles from "./LoginForm.module.css"

const SOCIAL_PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "facebook", label: "Facebook" },
] as const

export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number]["id"]

interface LoginFormProps {
  identifier: string
  password: string
  onIdentifierChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSocialSignIn: (provider: SocialProviderId) => void
  pending: boolean
  errorMessage: string | null
  onDismissError: () => void
}

export function LoginForm({
  identifier,
  password,
  onIdentifierChange,
  onPasswordChange,
  onSubmit,
  onSocialSignIn,
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
        <TextInput
          size="l"
          type="password"
          placeholder="Password"
          value={password}
          onUpdate={onPasswordChange}
          autoComplete="current-password"
        />
        <Button view="action" size="l" type="submit" loading={pending} width="max">
          Sign in
        </Button>
        <div className={styles.socialButtons}>
          {SOCIAL_PROVIDERS.map((provider) => (
            <Button
              key={provider.id}
              view="outlined"
              size="l"
              width="max"
              disabled={pending}
              onClick={() => onSocialSignIn(provider.id)}
            >
              Continue with {provider.label}
            </Button>
          ))}
        </div>
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
