"use client"

import { useState, type FormEvent } from "react"
import {
  Alert,
  Anchor,
  Button,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core"
import { completePasswordReset, requestPasswordReset } from "@/lib/passwordResetActions"

export function PasswordResetModal({
  initialIdentifier,
  onClose,
}: {
  initialIdentifier: string
  onClose: () => void
}) {
  const [identifier, setIdentifier] = useState(initialIdentifier)
  const [requestId, setRequestId] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [complete, setComplete] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const fields = new FormData(event.currentTarget)
    setError(undefined)
    setPending(true)
    try {
      if (!requestId) {
        const result = await requestPasswordReset(identifier)
        if (result.requestId) setRequestId(result.requestId)
        else setError(result.error)
        return
      }

      const result = await completePasswordReset(
        requestId,
        String(fields.get("code") ?? ""),
        String(fields.get("password") ?? ""),
        String(fields.get("confirmation") ?? ""),
      )
      if (result.ok) setComplete(true)
      else setError(result.error)
    } catch {
      setError("Something went wrong. Try again shortly.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal opened onClose={onClose} title="Reset your password" centered>
      {complete ? (
        <Stack gap="sm">
          <Text role="status">Password updated. You can now sign in with your new password.</Text>
          <Button onClick={onClose}>Done</Button>
        </Stack>
      ) : (
        <form onSubmit={submit}>
          <Stack gap="sm">
            {requestId ? (
              <>
                <Text size="sm" role="status">
                  If your account is eligible, Notes sends the code to Paul.{" "}
                  <Anchor
                    href="https://paulshorey.com/#contact-title"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Contact Paul
                  </Anchor>{" "}
                  with this reference so he can verify your account and share the code. The code
                  expires in 30 minutes.
                </Text>
                <TextInput label="Request reference" value={requestId} readOnly />
                <TextInput
                  label="Reset code"
                  name="code"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={32}
                  data-autofocus
                  required
                />
                <PasswordInput
                  label="New password"
                  name="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={1024}
                  required
                />
                <PasswordInput
                  label="Confirm new password"
                  name="confirmation"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={1024}
                  required
                />
              </>
            ) : (
              <>
                <Text size="sm">Request a code from Paul to recover your Notes account.</Text>
                <TextInput
                  label="Username, email, or phone"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.currentTarget.value)}
                  autoComplete="username"
                  maxLength={320}
                  data-autofocus
                  required
                />
              </>
            )}
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            <Group justify="space-between">
              {requestId && (
                <Button
                  variant="subtle"
                  disabled={pending}
                  onClick={() => {
                    setRequestId("")
                    setError(undefined)
                  }}
                >
                  Start over
                </Button>
              )}
              <Button type="submit" loading={pending}>
                {requestId ? "Reset password" : "Request reset code"}
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  )
}
