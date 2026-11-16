"use client"

import { isTextItem } from "@lib/db-items/contracts/item-content"
import {
  type BootstrapResponse,
  type EmbeddingMaintenanceResponse,
  type SessionResponse,
  type UserPreferences,
} from "@lib/db-items"
import { type RestoreBackupResponse } from "@lib/db-items/contracts/items-app"
import { type FormEvent } from "react"
import { signIn, signOut } from "next-auth/react"
import { STORAGE_KEY } from "@/constants/items"
import { fetchWithTimeout, getErrorMessage, itemsFetch, readJson } from "@/lib/api"
import { type EmbeddingMaintenanceMode } from "@/types/items"
import { clearItemsCache, writeItemsCache } from "@/lib/itemsCache"
import { clearOpenItemsSnapshot } from "@/lib/openItemsStorage"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import { type SignupFields } from "@/components/items/WorkspaceHeader"
import { RESULTS_COLUMN_DEFAULT_WIDTH, isResultsDrawerLayout } from "@/lib/resultsColumn"
import { clearPendingMergeToken, writePendingMergeToken } from "@/lib/pendingMergeToken"
import { isPreferencesObject, serializeUserPreferences } from "@/lib/userPreferences"
import type { WorkspaceStateOutput } from "./useWorkspaceState"
import type { WorkspaceDataOutput } from "./useWorkspaceData"
import type { ItemSaveEngineOutput } from "./useItemSaveEngine"
import type { OpenItemEntriesOutput } from "./useOpenItemEntries"
import type { ItemListsOutput } from "./useItemLists"

export function useAccountActions(
  ctx: WorkspaceStateOutput &
    WorkspaceDataOutput &
    ItemSaveEngineOutput &
    OpenItemEntriesOutput &
    ItemListsOutput,
) {
  const {
    activeWorkspaceId,
    activeWorkspaceIdRef,
    applyLoadedUser,
    authSession,
    clearMessages,
    detachedSavesRef,
    didRehydrateOpenItemsRef,
    flushAllPendingSaves,
    identifier,
    items,
    itemsRef,
    lastSavedPreferencesRef,
    openDraftEntry,
    password,
    persistOpenItems,
    preferenceSaveRequestIdRef,
    preferenceSavesInFlightRef,
    refreshResults,
    rehydrateOpenItems,
    resetItemsAppStore,
    setActiveWorkspaceId,
    setAuthPending,
    setCategories,
    setEmbeddingMaintenancePending,
    setErrorMessage,
    setIdentifier,
    setItems,
    setItemsLoading,
    setPassword,
    setPreferredResultsColumnWidth,
    setResultsColumnWidth,
    setResultsListVisible,
    setSearchErrorMessage,
    setSearchQuery,
    setSearchResults,
    setSessionLoading,
    setStatusMessage,
    setStatuses,
    setTags,
    setUser,
    setUserPreferences,
    setWorkspaces,
    user,
    userPreferencesRef,
  } = ctx

  const handleRunEmbeddingMaintenance = async (mode: EmbeddingMaintenanceMode) => {
    if (!user) return
    clearMessages()
    setEmbeddingMaintenancePending(mode)
    try {
      const response = await itemsFetch("/api/items/maintenance/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          workspaceId: activeWorkspaceId,
          mode,
          limit: Math.min(Math.max(items.length, 100), 500),
        }),
      })
      const data = await readJson<EmbeddingMaintenanceResponse>(response)
      await refreshResults(user.id)
      const parts: string[] = []
      if (data.tagsUpdated > 0) {
        parts.push(`${data.tagsUpdated} tag${data.tagsUpdated === 1 ? "" : "s"}`)
      }
      if (data.updated > 0) {
        parts.push(`${data.updated} note${data.updated === 1 ? "" : "s"}`)
      }
      setStatusMessage(
        parts.length === 0
          ? `Embedding maintenance (${mode}) found nothing to update.`
          : `Embedding maintenance (${mode}) updated ${parts.join(" and ")}${data.hasMore ? ". More remain; run again." : "."}`,
      )
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setEmbeddingMaintenancePending(null)
    }
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>): Promise<boolean> => {
    event.preventDefault()
    clearMessages()
    setAuthPending(true)
    try {
      // Persist every unsaved entry to the anonymous account before the
      // session changes, otherwise those drafts never reach the DB and the
      // merge below cannot move them. Aborting on failure mirrors the
      // merge-token rule below: stay anonymous and retry rather than sign in
      // and strand the notes on a row nobody will look at again.
      if (!(await flushAllPendingSaves())) {
        setErrorMessage(
          "Couldn't save all your notes before signing in. Check your connection and try again.",
        )
        return false
      }

      // While still anonymous, capture a signed merge token and stash it across
      // the sign-in transition. The single post-login loader (restoreSession)
      // performs the merge and the reload, so there is exactly one writer of
      // session data — no race.
      if (authSession?.user?.isAnonymous && authSession.user.itemsUserId) {
        let mergeTokenCaptured = false
        try {
          const tokenResponse = await itemsFetch("/api/anon-session/merge-token", {
            method: "POST",
          })
          if (tokenResponse.ok) {
            const tokenData = (await tokenResponse.json()) as { mergeToken: string }
            writePendingMergeToken(tokenData.mergeToken)
            mergeTokenCaptured = true
          }
        } catch {
          // Handled below — treated the same as a non-OK response.
        }

        // Without a token the merge can never run, and after sign-in the
        // anonymous session is gone, stranding the visitor's notes. When
        // there is anything to lose, abort while the user is still anonymous
        // so they can simply retry. An empty visitor session has nothing to
        // merge, so it proceeds without a token.
        if (!mergeTokenCaptured && itemsRef.current.length > 0) {
          setErrorMessage(
            "Couldn't prepare your notes to transfer to the account. Check your connection and try again.",
          )
          return false
        }
      }

      const result = await signIn("credentials", {
        identifier,
        password,
        redirect: false,
      })

      if (result?.error) {
        // Sign-in failed; the session is still anonymous. Drop the stashed
        // token so it is not applied on a later unrelated render.
        clearPendingMergeToken()
        setErrorMessage("Unable to sign in. Check your identifier and password.")
        return false
      }

      // A successful sign-in flips authSession to the real user, which re-runs
      // restoreSession. Show the loading state so the merge + single reload is
      // not interleaved with a flash of the outgoing anonymous data.
      setSessionLoading(true)
      setIdentifier("")
      setPassword("")
      return true
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      return false
    } finally {
      setAuthPending(false)
    }
  }

  const handleSignup = async (fields: SignupFields): Promise<boolean> => {
    clearMessages()

    const username = fields.username.trim()
    const email = fields.email.trim()
    if (username === "") {
      setErrorMessage("Username is required.")
      return false
    }
    if (fields.password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.")
      return false
    }
    if (email !== "" && !email.includes("@")) {
      setErrorMessage("Email must be a valid email address.")
      return false
    }

    setAuthPending(true)
    try {
      // Persist every unsaved entry before the claim. The data stays on the
      // same user row, but the debounced autosaves must not fire mid-transition.
      if (!(await flushAllPendingSaves())) {
        setErrorMessage(
          "Couldn't save all your notes before creating the account. Check your connection and try again.",
        )
        return false
      }

      // Claim the anonymous row in place: same user_id, identity + password set,
      // is_anonymous flipped to false. Nothing moves between users, so there is
      // no merge token and no race in this path.
      const claimResponse = await itemsFetch("/api/anon-session/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email: email === "" ? undefined : email,
          password: fields.password,
        }),
      })

      if (!claimResponse.ok) {
        if (claimResponse.status === 409) {
          setErrorMessage(
            "That username or email is already taken — sign in instead to keep your notes.",
          )
        } else {
          const body = (await claimResponse.json().catch(() => null)) as { error?: string } | null
          setErrorMessage(body?.error ?? "Unable to create the account. Try again.")
        }
        return false
      }

      // Apply the claimed identity to state and the local cache now. The
      // restoreSession re-run below takes the cache-first branch (same user id,
      // no merge token) and its background refresh keeps the in-memory user, so
      // without this the header would show the old anon-* username until a
      // full reload.
      const claimData = (await claimResponse.json()) as SessionResponse
      applyLoadedUser(claimData.user)

      // Re-mint the JWT for the same user id so isAnonymous flips to false.
      const result = await signIn("credentials", {
        identifier: username,
        password: fields.password,
        redirect: false,
      })

      if (result?.error) {
        // The account is already claimed; only the session refresh failed.
        setErrorMessage("Account created — sign in with your new username and password.")
        return false
      }

      // restoreSession re-fires (isAnonymous flipped) and refreshes the same
      // account's data. No merge token is pending, so it is a plain reload.
      setStatusMessage("Account created. Your notes are saved to it.")
      return true
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      return false
    } finally {
      setAuthPending(false)
    }
  }

  const handleLogout = async () => {
    // Signing out clears the ring and the local snapshot, so an unsaved note
    // that failed to persist would be gone for good. Refuse rather than
    // destroy it; the user can retry once the network recovers.
    if (!(await flushAllPendingSaves())) {
      setErrorMessage(
        "Couldn't save all your notes, so you're still signed in. Check your connection and try again.",
      )
      return
    }
    await signOut({ redirect: false })
    window.localStorage.removeItem(STORAGE_KEY)
    clearItemsCache()
    preferenceSaveRequestIdRef.current += 1
    lastSavedPreferencesRef.current = serializeUserPreferences({})
    setUser(null)
    setUserPreferences({})
    setCategories([])
    setStatuses([])
    setTags([])
    setWorkspaces([])
    setActiveWorkspaceId(null)
    setItems([])
    setSearchQuery("")
    setSearchResults([])
    setSearchErrorMessage(null)
    clearOpenItemsSnapshot()
    detachedSavesRef.current.clear()
    didRehydrateOpenItemsRef.current = false
    resetItemsAppStore()
    setResultsListVisible(!isResultsDrawerLayout())
    setPreferredResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
    setResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
    clearMessages()
  }

  const prepareDataTransfer = async () => {
    if (!user) throw new Error("Sign in before managing your data.")
    if (!(await flushAllPendingSaves())) {
      throw new Error("Couldn't save all your notes. Check your connection and try again.")
    }
    persistOpenItems()
    // A debounced preference PATCH must finish before export/restore, or it
    // could miss the backup or overwrite preferences imported moments later.
    preferenceSaveRequestIdRef.current++
    await Promise.all([...preferenceSavesInFlightRef.current])
    const preferences = userPreferencesRef.current
    if (serializeUserPreferences(preferences) !== lastSavedPreferencesRef.current) {
      const data = await readJson<SessionResponse>(
        await itemsFetch("/api/session", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferences }),
        }),
      )
      applyLoadedUser(data.user)
    }
  }

  const handleDownloadBackup = async () => {
    const store = useItemsAppStore.getState()
    if (store.backupOperation !== null) return
    store.setBackupOperation("download")
    try {
      await prepareDataTransfer()
      const response = await fetchWithTimeout("/api/backup", { cache: "no-store" }, 120_000)
      if (!response.ok) await readJson(response)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.href = url
      link.download = `jot-new-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatusMessage("Your backup download has started.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      throw error
    } finally {
      store.setBackupOperation(null)
    }
  }

  const handleRestoreBackup = async (file: File): Promise<RestoreBackupResponse> => {
    const store = useItemsAppStore.getState()
    if (store.backupOperation !== null) throw new Error("A backup operation is already running.")
    if (!user) throw new Error("Sign in before restoring a backup.")
    store.setBackupOperation("restore")
    try {
      await prepareDataTransfer()
      const result = await readJson<RestoreBackupResponse>(
        await fetchWithTimeout(
          "/api/backup",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: file },
          120_000,
        ),
      )
      // Merge is additive, so keep the current workspace and every open editor
      // entry. Refresh server data and cache without tearing down draft storage.
      try {
        const data = await readJson<BootstrapResponse>(
          await itemsFetch(`/api/bootstrap?workspaceId=${activeWorkspaceIdRef.current}`, {
            cache: "no-store",
          }),
        )
        if (data.user.id !== user.id) throw new Error("The active account changed.")
        applyLoadedUser(data.user)
        setWorkspaces(data.workspaces)
        setItems(data.items.filter(isTextItem))
        setCategories(data.categories)
        setStatuses(data.statuses)
        setTags(data.tags)
        setSearchResults([])
        writeItemsCache({
          userId: user.id,
          user: data.user,
          workspaces: data.workspaces,
          activeWorkspaceId: data.activeWorkspaceId,
          items: data.items,
          categories: data.categories,
          statuses: data.statuses,
          tags: data.tags,
        })
      } catch {
        // The committed import succeeded. Show that result even if the refresh
        // failed; an explicit retry is safe because exact copies are skipped.
        setErrorMessage(
          "Your backup was restored, but the view couldn't refresh. Reload to see the imported data.",
        )
      }
      return result
    } finally {
      store.setBackupOperation(null)
    }
  }

  const handleSwitchWorkspace = async (workspaceId: number) => {
    if (!user || workspaceId === activeWorkspaceId) return
    if (!(await flushAllPendingSaves())) {
      setErrorMessage("Couldn't save all notes, so the workspace was not changed.")
      return
    }
    persistOpenItems()
    setItemsLoading(true)
    try {
      const response = await itemsFetch(`/api/bootstrap?workspaceId=${workspaceId}`, {
        cache: "no-store",
      })
      const data = await readJson<BootstrapResponse>(response)
      setWorkspaces(data.workspaces)
      setActiveWorkspaceId(data.activeWorkspaceId)
      setItems(data.items.filter(isTextItem))
      setCategories(data.categories)
      setStatuses(data.statuses)
      setTags(data.tags)
      const nextUserPreferences: UserPreferences = {
        ...userPreferencesRef.current,
        notesApp: {
          ...(isPreferencesObject(userPreferencesRef.current.notesApp)
            ? userPreferencesRef.current.notesApp
            : {}),
          currentWorkspaceId: data.activeWorkspaceId,
        },
      }
      writeItemsCache({
        userId: user.id,
        user: { ...user, preferences: nextUserPreferences },
        workspaces: data.workspaces,
        activeWorkspaceId: data.activeWorkspaceId,
        items: data.items,
        categories: data.categories,
        statuses: data.statuses,
        tags: data.tags,
      })
      detachedSavesRef.current.clear()
      resetItemsAppStore()
      didRehydrateOpenItemsRef.current = false
      rehydrateOpenItems(user.id, {
        workspaceId: data.activeWorkspaceId,
        itemList: data.items,
        categoryList: data.categories,
        statusList: data.statuses,
        tagList: data.tags,
        pendingMerge: false,
        force: true,
      })
      if (useItemsAppStore.getState().openItems.length === 0) {
        openDraftEntry()
      }
      setUserPreferences(nextUserPreferences)
      setSearchQuery("")
      setStatusMessage(
        `Switched to “${data.workspaces.find((w) => w.id === data.activeWorkspaceId)?.label ?? "workspace"}”.`,
      )
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setItemsLoading(false)
    }
  }

  const handleCreateWorkspace = async (rawLabel: string) => {
    if (!user) return
    const label = rawLabel.trim().toLocaleLowerCase()
    if (!label) return
    try {
      const response = await itemsFetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, label }),
      })
      const data = await readJson<import("@lib/db-items").WorkspaceResponse>(response)
      setWorkspaces((current) => [
        ...current.filter((w) => w.id !== data.workspace.id),
        data.workspace,
      ])
      await handleSwitchWorkspace(data.workspace.id)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    }
  }

  return {
    handleRunEmbeddingMaintenance,
    handleLogin,
    handleSignup,
    handleLogout,
    prepareDataTransfer,
    handleDownloadBackup,
    handleRestoreBackup,
    handleSwitchWorkspace,
    handleCreateWorkspace,
  }
}

export type AccountActionsOutput = ReturnType<typeof useAccountActions>
