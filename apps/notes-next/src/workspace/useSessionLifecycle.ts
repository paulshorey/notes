"use client"

import { type BootstrapResponse, type SessionResponse } from "@lib/db-items"
import { useEffect } from "react"
import { signIn, signOut } from "next-auth/react"
import { STORAGE_KEY } from "@/constants/items"
import { RequestError, fetchWithTimeout, getErrorMessage, itemsFetch, readJson } from "@/lib/api"
import { recoverExpiredSession } from "@/lib/sessionRecovery"
import {
  clearItemsCache,
  readItemsCache,
  updateItemsCacheUser,
  writeItemsCache,
} from "@/lib/itemsCache"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import { RESULTS_COLUMN_DEFAULT_WIDTH, isResultsDrawerLayout } from "@/lib/resultsColumn"
import {
  clearPendingMergeToken,
  readPendingMergeToken,
  writePendingMergeToken,
} from "@/lib/pendingMergeToken"
import {
  getStoredResultsColumnWidth,
  normalizeUserPreferences,
  serializeUserPreferences,
} from "@/lib/userPreferences"
import { PREFERENCES_SAVE_DEBOUNCE_MS } from "@/workspace/shared"
import type { WorkspaceStateOutput } from "./useWorkspaceState"
import type { ResultsColumnLayoutOutput } from "./useResultsColumnLayout"
import type { WorkspaceDataOutput } from "./useWorkspaceData"
import type { OpenItemEntriesOutput } from "./useOpenItemEntries"

export function useSessionLifecycle(
  ctx: WorkspaceStateOutput &
    ResultsColumnLayoutOutput &
    WorkspaceDataOutput &
    OpenItemEntriesOutput,
) {
  const {
    anonymousSignInInFlightRef,
    applyItemsUrlSelection,
    applyLoadedUser,
    authSession,
    authStatus,
    backupOperation,
    clampResultsColumnWidth,
    detachedSavesRef,
    didRehydrateOpenItemsRef,
    lastSavedPreferencesRef,
    loadCategories,
    loadItems,
    loadTags,
    mergeInFlightRef,
    persistOpenItemsRef,
    preferenceSaveRequestIdRef,
    preferenceSavesInFlightRef,
    rehydrateOpenItems,
    resetItemsAppStore,
    setActiveWorkspaceId,
    setAnonymousSignInPending,
    setCategories,
    setErrorMessage,
    setItems,
    setPreferredResultsColumnWidth,
    setResultsColumnWidth,
    setResultsListVisible,
    setSearchErrorMessage,
    setSearchResults,
    setSessionLoading,
    setStartupErrorMessage,
    setStatuses,
    setTags,
    setUser,
    setUserPreferences,
    setWorkspaces,
    startupRetryKey,
    user,
    userPreferences,
    userPreferencesRef,
    userRef,
  } = ctx

  useEffect(() => {
    let active = true

    setStartupErrorMessage(null)
    setSessionLoading(true)

    const fetchFreshSession = async (
      userId: string | number,
      {
        applyUser,
        workspaceId,
      }: {
        applyUser: boolean
        workspaceId?: number
      },
    ) => {
      const bootstrapResponse = await fetchWithTimeout(
        workspaceId === undefined ? "/api/bootstrap" : `/api/bootstrap?workspaceId=${workspaceId}`,
        {
          cache: "no-store",
        },
      )
      const bootstrapData = await readJson<BootstrapResponse>(bootstrapResponse)
      const expectedUserId = Number(userId)
      if (Number.isInteger(expectedUserId) && bootstrapData.user.id !== expectedUserId) {
        throw new RequestError("The active session changed during startup.", 401)
      }
      const sessionData: SessionResponse = {
        user: bootstrapData.user,
      }

      // On the cache-first path the in-memory preferences came from a snapshot
      // that can be arbitrarily old. Whether the fresh server copy may replace
      // them turns on one question: has the user changed a preference that the
      // debounced PATCH has not saved yet?
      const hasUnsavedPreferenceEdit =
        serializeUserPreferences(userPreferencesRef.current) !== lastSavedPreferencesRef.current

      let userForCache = sessionData.user

      if (applyUser) {
        applyLoadedUser(sessionData.user)
      } else if (userRef.current?.id === sessionData.user.id) {
        if (hasUnsavedPreferenceEdit) {
          // Keep the local edit and cache it, so a reload before the PATCH
          // lands does not silently undo what the user just set.
          userForCache = { ...sessionData.user, preferences: userPreferencesRef.current }
        } else {
          // Nothing local to protect, so adopt the server copy now. Without
          // this the stale cached preferences survive the whole session and a
          // change made in another tab (or just before the last reload) takes
          // two reloads to appear.
          applyLoadedUser(sessionData.user)
        }
        updateItemsCacheUser(sessionData.user.id, userForCache)
      }

      const loadedItems = bootstrapData.items
      const loadedCategories = bootstrapData.categories
      const loadedStatuses = bootstrapData.statuses
      const loadedTags = bootstrapData.tags

      setItems(loadedItems)
      setCategories(loadedCategories)
      setStatuses(loadedStatuses)
      setTags(loadedTags)
      setWorkspaces(bootstrapData.workspaces)
      setActiveWorkspaceId(bootstrapData.activeWorkspaceId)

      writeItemsCache({
        userId: sessionData.user.id,
        user: userForCache,
        workspaces: bootstrapData.workspaces,
        activeWorkspaceId: bootstrapData.activeWorkspaceId,
        items: loadedItems,
        categories: loadedCategories,
        statuses: loadedStatuses,
        tags: loadedTags,
      })

      return {
        sessionData,
        activeWorkspaceId: bootstrapData.activeWorkspaceId,
        loadedItems,
        loadedCategories,
        loadedStatuses,
        loadedTags,
      }
    }

    const recoverSession = (error: unknown) =>
      recoverExpiredSession(error, {
        persistDrafts: () => persistOpenItemsRef.current(),
        resetSession: () => {
          setUser(null)
          setStartupErrorMessage("Your session expired. Starting a new visitor session…")
          window.localStorage.removeItem(STORAGE_KEY)
          clearItemsCache()
          preferenceSaveRequestIdRef.current += 1
          lastSavedPreferencesRef.current = serializeUserPreferences({})
          setUserPreferences({})
          setCategories([])
          setStatuses([])
          setTags([])
          setWorkspaces([])
          setActiveWorkspaceId(null)
          setItems([])
          detachedSavesRef.current.clear()
          didRehydrateOpenItemsRef.current = false
          resetItemsAppStore()
          setSearchResults([])
          setSearchErrorMessage(null)
          setResultsListVisible(!isResultsDrawerLayout())
          setPreferredResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
          setResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
        },
        signOut: () => signOut({ redirect: false }),
      })

    const restoreSession = async () => {
      if (authStatus === "loading") {
        return
      }

      if (authStatus !== "authenticated" || !authSession?.user?.itemsUserId) {
        window.localStorage.removeItem(STORAGE_KEY)
        setSessionLoading(false)
        return
      }

      const storedUserId = String(authSession.user.itemsUserId)
      window.localStorage.setItem(STORAGE_KEY, storedUserId)
      const numericUserId = Number.parseInt(storedUserId, 10)

      // If the user just signed in from an anonymous session, merge that
      // visitor data into the real account *before* loading anything. Running
      // the merge here — inside the single post-login loader — guarantees the
      // data loaded below is always post-merge, so there is no window where a
      // stale pre-merge fetch can win a race.
      const pendingMergeToken =
        !authSession.user.isAnonymous && !mergeInFlightRef.current ? readPendingMergeToken() : null

      if (pendingMergeToken) {
        mergeInFlightRef.current = true
        clearPendingMergeToken()
        try {
          let mergeResponse: Response | null = null
          try {
            mergeResponse = await itemsFetch("/api/anon-session/merge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mergeToken: pendingMergeToken }),
            })
          } catch {
            // Network failure — handled as retryable below.
          }

          if (!mergeResponse || !mergeResponse.ok) {
            // The real sign-in stays successful; the visitor data remains on
            // the anonymous row for the cleanup script. Surface a warning
            // rather than failing silently — and make retry actually work
            // where it can: transient failures (network, 5xx) re-stash the
            // token so the next restoreSession run (e.g. a page reload,
            // within the token's 10-minute TTL) retries the merge. A 4xx
            // means the token or the anonymous row is no longer valid, so a
            // retry cannot succeed and the token stays cleared.
            const retryable = !mergeResponse || mergeResponse.status >= 500
            if (retryable) {
              writePendingMergeToken(pendingMergeToken)
            }
            if (active) {
              setErrorMessage(
                retryable
                  ? "Signed in, but we couldn't move your visitor notes yet. Reload the page to try again."
                  : "Signed in, but your visitor notes couldn't be transferred to this account.",
              )
            }
          }
        } finally {
          mergeInFlightRef.current = false
        }
      }

      // Skip the stale-while-revalidate cache paint when a merge just ran: the
      // cached snapshot predates the merge, so we load fresh post-merge data in
      // a single pass instead.
      const cachedSnapshot =
        !pendingMergeToken && Number.isInteger(numericUserId) ? readItemsCache(numericUserId) : null

      // Stale-while-revalidate. If we have a recent local snapshot for this
      // user, render the app immediately from cache and refresh in the
      // background. This is what removes the "Restoring session…" wait on the
      // PWA homescreen launch when the user has opened the app before.
      if (cachedSnapshot) {
        applyLoadedUser(cachedSnapshot.user)
        setItems(cachedSnapshot.items)
        setCategories(cachedSnapshot.categories)
        setStatuses(cachedSnapshot.statuses)
        setTags(cachedSnapshot.tags)
        setWorkspaces(cachedSnapshot.workspaces)
        setActiveWorkspaceId(cachedSnapshot.activeWorkspaceId)
        // Reconcile against the cached list so the ring paints immediately…
        rehydrateOpenItems(cachedSnapshot.userId, {
          workspaceId: cachedSnapshot.activeWorkspaceId,
          itemList: cachedSnapshot.items,
          categoryList: cachedSnapshot.categories,
          statusList: cachedSnapshot.statuses,
          tagList: cachedSnapshot.tags,
          pendingMerge: Boolean(pendingMergeToken),
        })
        applyItemsUrlSelection({
          categoryList: cachedSnapshot.categories,
          itemList: cachedSnapshot.items,
          tagList: cachedSnapshot.tags,
        })
        setSessionLoading(false)

        try {
          const refreshed = await fetchFreshSession(cachedSnapshot.userId, {
            applyUser: false,
            workspaceId: cachedSnapshot.activeWorkspaceId,
          })
          if (!active) return
          // …then again once the real data lands. The cached list can be up to
          // two weeks old, so it cannot be trusted to say whether a note still
          // exists. Reconciling is idempotent and never touches a dirty entry,
          // so the second pass only corrects clean ones.
          rehydrateOpenItems(cachedSnapshot.userId, {
            workspaceId: refreshed.activeWorkspaceId,
            itemList: refreshed.loadedItems,
            categoryList: refreshed.loadedCategories,
            statusList: refreshed.loadedStatuses,
            tagList: refreshed.loadedTags,
            pendingMerge: false,
            force: true,
          })
        } catch (error) {
          if (!active) return
          try {
            await recoverSession(error)
          } catch (recoveryError) {
            setStartupErrorMessage(getErrorMessage(recoveryError))
          }
          // Network and server failures keep the cached view and its drafts.
          // A confirmed 401 ends the stale session on this path too.
        }
        return
      }

      try {
        const result = await fetchFreshSession(storedUserId, { applyUser: true })
        if (!active) return

        rehydrateOpenItems(result.sessionData.user.id, {
          workspaceId: result.activeWorkspaceId,
          itemList: result.loadedItems,
          categoryList: result.loadedCategories,
          statusList: result.loadedStatuses,
          tagList: result.loadedTags,
          pendingMerge: Boolean(pendingMergeToken),
        })
        applyItemsUrlSelection({
          categoryList: result.loadedCategories,
          itemList: result.loadedItems,
          tagList: result.loadedTags,
        })
      } catch (error) {
        if (!active) return
        try {
          if (await recoverSession(error)) return
        } catch (recoveryError) {
          setUser(null)
          setStartupErrorMessage(getErrorMessage(recoveryError))
          return
        }

        // An outage is not evidence that the session or persisted drafts are
        // invalid. Keep them intact and offer an explicit retry.
        setUser(null)
        setStartupErrorMessage(getErrorMessage(error))
      } finally {
        if (active) setSessionLoading(false)
      }
    }

    void restoreSession()
    return () => {
      active = false
    }
  }, [
    authSession?.user?.itemsUserId,
    authSession?.user?.isAnonymous,
    authStatus,
    startupRetryKey,
    applyLoadedUser,
    loadCategories,
    loadTags,
    loadItems,
    applyItemsUrlSelection,
    rehydrateOpenItems,
    resetItemsAppStore,
    setResultsListVisible,
    setStartupErrorMessage,
    setSessionLoading,
    userPreferencesRef,
    lastSavedPreferencesRef,
    userRef,
    setItems,
    setCategories,
    setStatuses,
    setTags,
    setWorkspaces,
    setActiveWorkspaceId,
    persistOpenItemsRef,
    setUser,
    preferenceSaveRequestIdRef,
    setUserPreferences,
    detachedSavesRef,
    didRehydrateOpenItemsRef,
    setSearchResults,
    setSearchErrorMessage,
    setPreferredResultsColumnWidth,
    setResultsColumnWidth,
    mergeInFlightRef,
    setErrorMessage,
  ])

  useEffect(() => {
    if (!user || backupOperation !== null) return

    const serializedPreferences = serializeUserPreferences(userPreferences)
    if (serializedPreferences === lastSavedPreferencesRef.current) return

    const requestId = preferenceSaveRequestIdRef.current + 1
    preferenceSaveRequestIdRef.current = requestId

    const timeoutId = window.setTimeout(() => {
      if (useItemsAppStore.getState().backupOperation !== null) return
      const pendingSave = itemsFetch("/api/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          preferences: userPreferences,
        }),
      })
        .then((response) => readJson<SessionResponse>(response))
        .then((data) => {
          if (preferenceSaveRequestIdRef.current !== requestId) return

          const nextPreferences = normalizeUserPreferences(data.user.preferences)
          const nextPreferredResultsColumnWidth =
            getStoredResultsColumnWidth(nextPreferences) ?? RESULTS_COLUMN_DEFAULT_WIDTH
          lastSavedPreferencesRef.current = serializeUserPreferences(nextPreferences)
          setUser({ ...data.user, preferences: nextPreferences })
          setUserPreferences(nextPreferences)
          // Also refresh the cached snapshot. The next launch paints from that
          // cache and its background refresh runs with applyUser: false, so a
          // stale copy here would show the old preference for a whole session.
          updateItemsCacheUser(data.user.id, { ...data.user, preferences: nextPreferences })
          setPreferredResultsColumnWidth(nextPreferredResultsColumnWidth)
          setResultsColumnWidth(clampResultsColumnWidth(nextPreferredResultsColumnWidth))
        })
        .catch((error: unknown) => {
          if (preferenceSaveRequestIdRef.current !== requestId) return
          setErrorMessage(getErrorMessage(error))
        })
        .finally(() => preferenceSavesInFlightRef.current.delete(pendingSave))
      preferenceSavesInFlightRef.current.add(pendingSave)
    }, PREFERENCES_SAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [
    backupOperation,
    clampResultsColumnWidth,
    lastSavedPreferencesRef,
    preferenceSaveRequestIdRef,
    preferenceSavesInFlightRef,
    setErrorMessage,
    setPreferredResultsColumnWidth,
    setResultsColumnWidth,
    setUser,
    setUserPreferences,
    user,
    userPreferences,
  ])

  // Auto-create anonymous session if unauthenticated
  useEffect(() => {
    if (authStatus !== "unauthenticated" || anonymousSignInInFlightRef.current) return

    let active = true
    anonymousSignInInFlightRef.current = true
    setAnonymousSignInPending(true)
    setStartupErrorMessage(null)

    void (async () => {
      try {
        const result = await signIn("anonymous", { redirect: false })
        if (!active) return

        const returnedError = result?.error
        const redirectError = (() => {
          if (!result?.url) return null
          try {
            return new URL(result.url).searchParams.get("error")
          } catch {
            return null
          }
        })()

        if (returnedError || redirectError || !result?.ok) {
          let message = "Notes could not create a visitor session."
          try {
            const healthResponse = await fetchWithTimeout("/api/health", {
              cache: "no-store",
            })
            if (healthResponse.status === 503) {
              message = "The Notes database is unavailable. Check the local connection and retry."
            }
          } catch {
            message = "Notes could not reach the server. Check the connection and retry."
          }
          if (active) setStartupErrorMessage(message)
        }
      } catch (error) {
        if (active) setStartupErrorMessage(getErrorMessage(error))
      } finally {
        anonymousSignInInFlightRef.current = false
        if (active) {
          setAnonymousSignInPending(false)
          setSessionLoading(false)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [
    anonymousSignInInFlightRef,
    authStatus,
    setAnonymousSignInPending,
    setSessionLoading,
    setStartupErrorMessage,
    startupRetryKey,
  ])

  return {}
}

export type SessionLifecycleOutput = ReturnType<typeof useSessionLifecycle>
