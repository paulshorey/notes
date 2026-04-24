"use client"

import type {
  CategoriesResponse,
  CategoryRecord,
  CreateCategoryResponse,
  DeleteCategoryResponse,
  TagsResponse,
  TagRecord,
  CreateTagResponse,
  DeleteTagResponse,
  EmbeddingMaintenanceResponse,
  NotesResponse,
  NoteRecord,
  SearchResponse,
  SessionResponse,
  UpdateCategoryResponse,
  UpdateTagResponse,
  UserSummary,
} from "@lib/db-marketing"
import { NOTES_APP_SEARCH_MAX_RESULTS } from "@lib/db-marketing/notes-search-constants"
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Text, TextInput } from "@gravity-ui/uikit"
import { STORAGE_KEY } from "@/constants/notes"
import { getErrorMessage, readJson } from "@/lib/api"
import { normalizeLabel, toLowercaseInput } from "@/lib/strings"
import {
  createDefaultNoteForm,
  noteToFormState,
  type EmbeddingMaintenanceMode,
  type NoteFormState,
} from "@/types/notes"
import { useAutoDismissStatus } from "@/hooks/useAutoDismissStatus"
import { FeedbackNotifications } from "./FeedbackNotifications"
import { FilterBanners } from "./FilterBanners"
import { LoginForm } from "./LoginForm"
import { NoteForm } from "./NoteForm"
import { NoteResultsList, type DisplayNoteItem } from "./NoteResultsList"
import { NotesHeader } from "./NotesHeader"
import { DeleteCategoryModal } from "./modals/DeleteCategoryModal"
import { DeleteTagModal } from "./modals/DeleteTagModal"
import { EditCategoryModal } from "./modals/EditCategoryModal"
import { EditTagModal } from "./modals/EditTagModal"
import styles from "./NotesApp.module.css"

export default function NotesApp() {
  const [identifier, setIdentifier] = useState("")
  const [user, setUser] = useState<UserSummary | null>(null)
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [tags, setTags] = useState<TagRecord[]>([])
  const fallbackCategoryId =
    categories.length > 0 ? categories.reduce((a, b) => (a.id < b.id ? a : b)).id : null
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResponse["results"]>([])
  const [noteForm, setNoteForm] = useState<NoteFormState>(() => createDefaultNoteForm())
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [notesLoading, setNotesLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [authPending, setAuthPending] = useState(false)
  const [notePending, setNotePending] = useState(false)
  const [embeddingMaintenancePending, setEmbeddingMaintenancePending] =
    useState<EmbeddingMaintenanceMode | null>(null)
  const [createCategoryPending, setCreateCategoryPending] = useState(false)
  const [createTagPending, setCreateTagPending] = useState(false)
  const [categoryInputValue, setCategoryInputValue] = useState("")
  const [pendingTagLabels, setPendingTagLabels] = useState<string[]>([])
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchErrorMessage, setSearchErrorMessage] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState<CategoryRecord | null>(null)
  const [editCategoryLabel, setEditCategoryLabel] = useState("")
  const [editCategoryPending, setEditCategoryPending] = useState(false)
  const [deletingCategory, setDeletingCategory] = useState<CategoryRecord | null>(null)
  const [deleteCategoryPending, setDeleteCategoryPending] = useState(false)
  const [editingTag, setEditingTag] = useState<TagRecord | null>(null)
  const [editTagLabel, setEditTagLabel] = useState("")
  const [editTagPending, setEditTagPending] = useState(false)
  const [deletingTag, setDeletingTag] = useState<TagRecord | null>(null)
  const [deleteTagPending, setDeleteTagPending] = useState(false)
  const pendingTagLabelsRef = useRef<string[]>([])
  const creatingTagLabelsRef = useRef(new Set<string>())
  const trimmedSearchQuery = searchQuery.trim()
  const searchMode = trimmedSearchQuery.length > 0

  useEffect(() => {
    pendingTagLabelsRef.current = pendingTagLabels
  }, [pendingTagLabels])

  const clearStatusMessage = useCallback(() => setStatusMessage(null), [])
  useAutoDismissStatus(statusMessage, clearStatusMessage)

  const clearMessages = useCallback(() => {
    setStatusMessage(null)
    setErrorMessage(null)
    setSearchErrorMessage(null)
  }, [])

  const resetNoteForm = useCallback(() => {
    const defaultCategoryId =
      categories.length > 0
        ? categories.reduce((a, b) => (a.id < b.id ? a : b)).id
        : null
    setNoteForm(() => ({
      ...createDefaultNoteForm(),
      selectedCategoryId: defaultCategoryId,
    }))
    setEditingNoteId(null)
    setPendingTagLabels([])
  }, [categories])

  const loadNotes = useCallback(async (userId: number) => {
    setNotesLoading(true)
    try {
      const response = await fetch(`/api/notes?userId=${userId}`, { cache: "no-store" })
      const data = await readJson<NotesResponse>(response)
      setNotes(data.notes)
      return data.notes
    } finally {
      setNotesLoading(false)
    }
  }, [])

  const loadCategories = useCallback(async (userId: number) => {
    const response = await fetch(`/api/categories?userId=${userId}`, { cache: "no-store" })
    const data = await readJson<CategoriesResponse>(response)
    setCategories(data.categories)
    return data.categories
  }, [])

  const loadTags = useCallback(async (userId: number) => {
    const response = await fetch(`/api/tags?userId=${userId}`, { cache: "no-store" })
    const data = await readJson<TagsResponse>(response)
    setTags(data.tags)
    return data.tags
  }, [])

  const runSearch = useCallback(async (userId: number, query: string, limit: number) => {
    const response = await fetch("/api/notes/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        query,
        limit: Math.min(Math.max(limit, 1), NOTES_APP_SEARCH_MAX_RESULTS),
      }),
    })
    const data = await readJson<SearchResponse>(response)
    setSearchResults(data.results)
    return data.results
  }, [])

  useEffect(() => {
    let active = true

    const restoreSession = async () => {
      const storedUserId = window.localStorage.getItem(STORAGE_KEY)

      if (!storedUserId) {
        setSessionLoading(false)
        return
      }

      try {
        const sessionResponse = await fetch(`/api/session?userId=${storedUserId}`, {
          cache: "no-store",
        })
        const sessionData = await readJson<SessionResponse>(sessionResponse)

        if (!active) return

        setUser(sessionData.user)
        const [, loadedCategories] = await Promise.all([
          loadNotes(sessionData.user.id),
          loadCategories(sessionData.user.id),
          loadTags(sessionData.user.id),
        ])
        if (loadedCategories && loadedCategories.length > 0) {
          const defaultCat = loadedCategories.reduce((a, b) => (a.id < b.id ? a : b))
          setNoteForm((prev) => ({ ...prev, selectedCategoryId: defaultCat.id }))
        }
      } catch (error) {
        if (!active) return
        window.localStorage.removeItem(STORAGE_KEY)
        setUser(null)
        setCategories([])
        setTags([])
        setNotes([])
        setErrorMessage(getErrorMessage(error))
      } finally {
        if (active) setSessionLoading(false)
      }
    }

    void restoreSession()
    return () => {
      active = false
    }
  }, [loadCategories, loadTags, loadNotes])

  useEffect(() => {
    if (!user) {
      setSearchResults([])
      setSearchErrorMessage(null)
      setSearchLoading(false)
      return
    }

    if (!trimmedSearchQuery) {
      setSearchResults([])
      setSearchErrorMessage(null)
      setSearchLoading(false)
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      setSearchLoading(true)
      setSearchErrorMessage(null)

      void fetch("/api/notes/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          query: trimmedSearchQuery,
          limit: NOTES_APP_SEARCH_MAX_RESULTS,
        }),
        signal: controller.signal,
      })
        .then((response) => readJson<SearchResponse>(response))
        .then((data) => {
          setSearchResults(data.results)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setSearchResults([])
          setSearchErrorMessage(getErrorMessage(error))
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false)
        })
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [notes.length, trimmedSearchQuery, user])

  const refreshResults = useCallback(
    async (userId: number) => {
      const [latestNotes, latestCategories] = await Promise.all([
        loadNotes(userId),
        loadCategories(userId),
        loadTags(userId),
      ])
      void latestNotes
      setNoteForm((prev) => {
        if (
          prev.selectedCategoryId !== null &&
          latestCategories.some((category) => category.id === prev.selectedCategoryId)
        ) {
          return prev
        }

        return {
          ...prev,
          selectedCategoryId: latestCategories[0]?.id ?? null,
        }
      })
      if (trimmedSearchQuery) {
        await runSearch(userId, trimmedSearchQuery, NOTES_APP_SEARCH_MAX_RESULTS)
      }
    },
    [loadCategories, loadTags, loadNotes, runSearch, trimmedSearchQuery],
  )

  const visibleItems = useMemo<DisplayNoteItem[]>(() => {
    const matchesCategory = (note: NoteRecord) =>
      selectedCategoryId === null || note.category.id === selectedCategoryId
    const matchesTag = (note: NoteRecord) =>
      selectedTagId === null || note.tags.some((c) => c.id === selectedTagId)

    if (searchMode) {
      return [...searchResults]
        .filter((result) => matchesCategory(result.note) && matchesTag(result.note))
        .sort((left, right) => right.similarity - left.similarity)
        .map((result) => ({
          note: result.note,
          relevance: result.similarity,
        }))
    }

    return [...notes]
      .filter((note) => matchesCategory(note) && matchesTag(note))
      .sort(
        (left, right) =>
          new Date(right.timeModified).getTime() - new Date(left.timeModified).getTime(),
      )
      .map((note) => ({ note }))
  }, [notes, searchMode, searchResults, selectedCategoryId, selectedTagId])

  const selectedCategory = useMemo(
    () =>
      selectedCategoryId === null
        ? null
        : categories.find((category) => category.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  )

  const selectedTag = useMemo(
    () =>
      selectedTagId === null ? null : tags.find((c) => c.id === selectedTagId) ?? null,
    [tags, selectedTagId],
  )

  const handleTagValuesChange = (nextValues: string[]) => {
    const cleanedValues: string[] = []
    const seen = new Set<string>()

    for (const rawValue of nextValues) {
      const value = normalizeLabel(rawValue)
      const normalized = normalizeLabel(value)
      if (normalized === "" || seen.has(normalized)) {
        continue
      }
      seen.add(normalized)
      cleanedValues.push(value)
    }

    const nextSelectedTagIds = cleanedValues.flatMap((value) => {
      const matchingTag = tags.find((tag) => normalizeLabel(tag.label) === normalizeLabel(value))
      return matchingTag ? [matchingTag.id] : []
    })
    const nextPendingLabels = cleanedValues.filter(
      (value) => !tags.some((tag) => normalizeLabel(tag.label) === normalizeLabel(value)),
    )

    setNoteForm((prev) => ({
      ...prev,
      selectedTagIds: nextSelectedTagIds,
    }))
    setPendingTagLabels(nextPendingLabels)
    nextPendingLabels.forEach((label) => {
      void handleCreateTag(label)
    })
  }

  const handleRefreshNotes = async () => {
    if (!user) return
    clearMessages()
    try {
      await refreshResults(user.id)
      setStatusMessage("Notes refreshed.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    }
  }

  const handleRunEmbeddingMaintenance = async (mode: EmbeddingMaintenanceMode) => {
    if (!user) return
    clearMessages()
    setEmbeddingMaintenancePending(mode)
    try {
      const response = await fetch("/api/notes/maintenance/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          mode,
          limit: Math.min(Math.max(notes.length, 100), 500),
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

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    clearMessages()
    setAuthPending(true)
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      })
      const data = await readJson<SessionResponse>(response)
      window.localStorage.setItem(STORAGE_KEY, String(data.user.id))
      setUser(data.user)
      await loadCategories(data.user.id)
      await loadTags(data.user.id)
      setIdentifier("")
      resetNoteForm()
      setSearchQuery("")
      setSearchResults([])
      setSearchErrorMessage(null)
      await loadNotes(data.user.id)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setAuthPending(false)
      setSessionLoading(false)
    }
  }

  const handleLogout = () => {
    window.localStorage.removeItem(STORAGE_KEY)
    setUser(null)
    setCategories([])
    setTags([])
    setNotes([])
    setSearchQuery("")
    setSearchResults([])
    setSearchErrorMessage(null)
    setSelectedCategoryId(null)
    setSelectedTagId(null)
    resetNoteForm()
    clearMessages()
  }

  const handleStartEdit = (note: NoteRecord) => {
    clearMessages()
    setEditingNoteId(note.id)
    setPendingTagLabels([])
    setNoteForm(noteToFormState(note))
  }

  const handleSelectCategory = (rawId: string) => {
    if (rawId === "") {
      return
    }
    const id = Number.parseInt(rawId, 10)
    if (!Number.isInteger(id) || id < 1) {
      return
    }
    const category = categories.find((item) => item.id === id)
    if (!category) {
      return
    }
    setNoteForm((prev) => ({
      ...prev,
      selectedCategoryId: category.id,
    }))
    setCategoryInputValue(category.label)
  }

  const handleCreateTag = async (rawLabel: string) => {
    if (!user) {
      setErrorMessage("Sign in before adding tags.")
      return
    }
    const label = rawLabel.trim()
    if (label === "") {
      return
    }
    const normalizedLabel = normalizeLabel(label)
    const existingTag = tags.find((tag) => normalizeLabel(tag.label) === normalizedLabel)
    if (existingTag) {
      setPendingTagLabels((prev) =>
        prev.filter((item) => normalizeLabel(item) !== normalizedLabel),
      )
      setNoteForm((prev) => ({
        ...prev,
        selectedTagIds: prev.selectedTagIds.includes(existingTag.id)
          ? prev.selectedTagIds
          : [...prev.selectedTagIds, existingTag.id],
      }))
      return
    }
    if (creatingTagLabelsRef.current.has(normalizedLabel)) {
      return
    }
    clearMessages()
    creatingTagLabelsRef.current.add(normalizedLabel)
    setCreateTagPending(true)
    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, label }),
      })
      const data = await readJson<CreateTagResponse>(response)
      setTags((prev) => {
        const without = prev.filter((c) => c.id !== data.tag.id)
        return [...without, data.tag].sort((a, b) =>
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
        )
      })
      const shouldKeepSelected = pendingTagLabelsRef.current.some(
        (item) => normalizeLabel(item) === normalizedLabel,
      )
      setPendingTagLabels((prev) =>
        prev.filter((item) => normalizeLabel(item) !== normalizedLabel),
      )
      if (shouldKeepSelected) {
        setNoteForm((prev) => ({
          ...prev,
          selectedTagIds: prev.selectedTagIds.includes(data.tag.id)
            ? prev.selectedTagIds
            : [...prev.selectedTagIds, data.tag.id],
        }))
      }
      setStatusMessage(`Tag “${data.tag.label}” added.`)
    } catch (error) {
      setPendingTagLabels((prev) =>
        prev.filter((item) => normalizeLabel(item) !== normalizedLabel),
      )
      setErrorMessage(getErrorMessage(error))
    } finally {
      creatingTagLabelsRef.current.delete(normalizedLabel)
      setCreateTagPending(false)
    }
  }

  const handleCreateCategory = async (rawLabel: string) => {
    if (!user) {
      setErrorMessage("Sign in before adding categories.")
      return
    }
    const label = rawLabel.trim()
    if (label === "") {
      return
    }
    const existingCategory = categories.find(
      (category) => normalizeLabel(category.label) === normalizeLabel(label),
    )
    if (existingCategory) {
      setNoteForm((prev) => ({
        ...prev,
        selectedCategoryId: existingCategory.id,
      }))
      setCategoryInputValue(existingCategory.label)
      return
    }
    clearMessages()
    setCreateCategoryPending(true)
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, label }),
      })
      const data = await readJson<CreateCategoryResponse>(response)
      setCategories((prev) => {
        const without = prev.filter((category) => category.id !== data.category.id)
        return [...without, data.category].sort((a, b) =>
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
        )
      })
      setNoteForm((prev) => ({
        ...prev,
        selectedCategoryId: data.category.id,
      }))
      setCategoryInputValue(data.category.label)
      setStatusMessage(`Category “${data.category.label}” added.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setCreateCategoryPending(false)
    }
  }

  const handleSaveNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) {
      setErrorMessage("Sign in before editing notes.")
      return
    }
    if (noteForm.selectedCategoryId === null) {
      setErrorMessage("Choose a category before saving the note.")
      return
    }
    clearMessages()
    setNotePending(true)
    try {
      const response = await fetch("/api/notes", {
        method: editingNoteId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          noteId: editingNoteId,
          note: {
            categoryId: noteForm.selectedCategoryId,
            tagIds: noteForm.selectedTagIds,
            description: noteForm.description,
            timeDue: noteForm.timeDue,
            timeRemind: noteForm.timeRemind,
          },
        }),
      })
      await readJson<{ note: NoteRecord }>(response)
      await refreshResults(user.id)
      resetNoteForm()
      setStatusMessage(editingNoteId ? "Note updated." : "Note created.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setNotePending(false)
    }
  }

  const openEditCategory = (category: CategoryRecord) => {
    clearMessages()
    setEditingCategory(category)
    setEditCategoryLabel(category.label)
  }

  const closeEditCategory = () => {
    setEditingCategory(null)
    setEditCategoryLabel("")
  }

  const handleSaveCategory = async () => {
    if (!user || !editingCategory) return
    const label = editCategoryLabel.trim()
    if (label === "" || label === editingCategory.label) {
      closeEditCategory()
      return
    }
    clearMessages()
    setEditCategoryPending(true)
    try {
      const response = await fetch("/api/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          categoryId: editingCategory.id,
          label,
        }),
      })
      const data = await readJson<UpdateCategoryResponse>(response)
      setCategories((prev) =>
        prev
          .map((category) => (category.id === data.category.id ? data.category : category))
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
      )
      await loadNotes(user.id)
      setStatusMessage(`Category renamed to “${data.category.label}”.`)
      closeEditCategory()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setEditCategoryPending(false)
    }
  }

  const performDeleteCategory = async (category: CategoryRecord) => {
    if (!user) return
    clearMessages()
    setDeleteCategoryPending(true)
    try {
      const response = await fetch("/api/categories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          categoryId: category.id,
        }),
      })
      await readJson<DeleteCategoryResponse>(response)
      await refreshResults(user.id)
      setStatusMessage(`Category “${category.label}” deleted.`)
      setDeletingCategory(null)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setDeleteCategoryPending(false)
    }
  }

  const openDeleteCategory = (category: CategoryRecord) => {
    clearMessages()
    if (categories.length <= 1) {
      setErrorMessage("Create another category before deleting the last one.")
      return
    }
    setDeletingCategory(category)
  }

  const closeDeleteCategory = () => {
    setDeletingCategory(null)
  }

  const handleConfirmDeleteCategory = async () => {
    if (!deletingCategory) return
    await performDeleteCategory(deletingCategory)
  }

  const openEditTag = (tag: TagRecord) => {
    clearMessages()
    setEditingTag(tag)
    setEditTagLabel(tag.label)
  }

  const closeEditTag = () => {
    setEditingTag(null)
    setEditTagLabel("")
  }

  const handleSaveTag = async () => {
    if (!user || !editingTag) return
    const label = editTagLabel.trim()
    if (label === "" || label === editingTag.label) {
      closeEditTag()
      return
    }
    clearMessages()
    setEditTagPending(true)
    try {
      const response = await fetch("/api/tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          tagId: editingTag.id,
          label,
        }),
      })
      const data = await readJson<UpdateTagResponse>(response)
      setTags((prev) =>
        prev
          .map((c) => (c.id === data.tag.id ? data.tag : c))
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
      )
      await loadNotes(user.id)
      setStatusMessage(`Tag renamed to “${data.tag.label}”.`)
      closeEditTag()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setEditTagPending(false)
    }
  }

  const performDeleteTag = async (tag: TagRecord) => {
    if (!user) return
    clearMessages()
    setDeleteTagPending(true)
    try {
      const response = await fetch("/api/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          tagId: tag.id,
        }),
      })
      const data = await readJson<DeleteTagResponse>(response)
      setTags((prev) => prev.filter((c) => c.id !== tag.id))
      if (selectedTagId === tag.id) {
        setSelectedTagId(null)
      }
      await refreshResults(user.id)
      setStatusMessage(
        data.deletedLinks === 0
          ? `Tag “${tag.label}” deleted.`
          : `Tag “${tag.label}” deleted (removed from ${data.deletedLinks} ${
              data.deletedLinks === 1 ? "note" : "notes"
            }).`,
      )
      setDeletingTag(null)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setDeleteTagPending(false)
    }
  }

  const openDeleteTag = (tag: TagRecord) => {
    clearMessages()
    if (tag.noteCount === 0) {
      void performDeleteTag(tag)
    } else {
      setDeletingTag(tag)
    }
  }

  const closeDeleteTag = () => {
    setDeletingTag(null)
  }

  const handleConfirmDeleteTag = async () => {
    if (!deletingTag) return
    await performDeleteTag(deletingTag)
  }

  const handleDeleteNote = async (noteId: number) => {
    if (!user) return
    clearMessages()
    setDeletingNoteId(noteId)
    try {
      const response = await fetch("/api/notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, noteId }),
      })
      await readJson<{ ok: true }>(response)
      await refreshResults(user.id)
      if (editingNoteId === noteId) resetNoteForm()
      setStatusMessage("Note deleted.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setDeletingNoteId(null)
    }
  }

  if (sessionLoading) {
    return (
      <div className={styles.page}>
        <Text variant="body-1" color="secondary">
          Restoring session…
        </Text>
      </div>
    )
  }

  if (!user) {
    return (
      <LoginForm
        identifier={identifier}
        onIdentifierChange={setIdentifier}
        onSubmit={handleLogin}
        pending={authPending}
        errorMessage={errorMessage}
        onDismissError={() => setErrorMessage(null)}
      />
    )
  }

  return (
    <div className={styles.page}>
      <FeedbackNotifications
        statusMessage={statusMessage}
        errorMessage={errorMessage}
        searchErrorMessage={searchErrorMessage}
        onDismissStatus={() => setStatusMessage(null)}
        onDismissError={() => setErrorMessage(null)}
        onDismissSearchError={() => setSearchErrorMessage(null)}
      />

      <div className={styles.content}>
        <section className={styles.resultsColumn}>
          <div className={styles.header}>
            <FilterBanners
              categories={categories}
              tags={tags}
              notesCount={notes.length}
              selectedCategory={selectedCategory}
              selectedTag={selectedTag}
              selectedCategoryId={selectedCategoryId}
              selectedTagId={selectedTagId}
              fallbackCategoryId={fallbackCategoryId}
              onSelectCategory={setSelectedCategoryId}
              onSelectTag={setSelectedTagId}
              onEditCategory={openEditCategory}
              onDeleteCategory={openDeleteCategory}
              onEditTag={openEditTag}
              onDeleteTag={openDeleteTag}
            />
          </div>
          <div className={styles.searchForm}>
            <div className={styles.searchRow}>
              <TextInput
                size="l"
                placeholder="Search"
                value={searchQuery}
                onUpdate={(value) => setSearchQuery(toLowercaseInput(value))}
                className={styles.searchInput}
              />
            </div>
          </div>
          <div className={styles.noteResults}>
            <NoteResultsList
              items={visibleItems}
              activeNoteId={editingNoteId}
              loading={searchMode ? searchLoading || notesLoading : notesLoading}
              emptyMessage={
                selectedCategory
                  ? `No notes in category “${selectedCategory.label}”.`
                  : selectedTag
                    ? `No notes in “${selectedTag.label}”.`
                    : searchMode
                      ? "No notes in your account."
                      : "No notes yet."
              }
              onEdit={handleStartEdit}
            />
          </div>
        </section>

        <NoteForm
          form={noteForm}
          setForm={setNoteForm}
          editingNoteId={editingNoteId}
          notePending={notePending}
          deletingNoteId={deletingNoteId}
          userPresent={Boolean(user)}
          categories={categories}
          tags={tags}
          pendingTagLabels={pendingTagLabels}
          categoryInputValue={categoryInputValue}
          onCategoryInputValueChange={setCategoryInputValue}
          createCategoryPending={createCategoryPending}
          createTagPending={createTagPending}
          onSelectCategoryId={handleSelectCategory}
          onCreateCategory={handleCreateCategory}
          onTagValuesChange={handleTagValuesChange}
          onSubmit={handleSaveNote}
          onDeleteNote={(noteId) => void handleDeleteNote(noteId)}
          onCancelEdit={resetNoteForm}
          header={
            <div className={styles.header}>
              <div className={styles.headerActions} />
              <NotesHeader
                user={user}
                notesLoading={notesLoading}
                onRefresh={() => void handleRefreshNotes()}
                onLogout={handleLogout}
                embeddingMaintenancePending={embeddingMaintenancePending}
                onRunEmbeddingMaintenance={(mode) => void handleRunEmbeddingMaintenance(mode)}
              />
            </div>
          }
        />
      </div>

      <EditCategoryModal
        category={editingCategory}
        label={editCategoryLabel}
        onLabelChange={setEditCategoryLabel}
        onClose={closeEditCategory}
        onSave={() => void handleSaveCategory()}
        pending={editCategoryPending}
      />

      <DeleteCategoryModal
        category={deletingCategory}
        onClose={closeDeleteCategory}
        onConfirm={() => void handleConfirmDeleteCategory()}
        pending={deleteCategoryPending}
      />

      <EditTagModal
        tag={editingTag}
        label={editTagLabel}
        onLabelChange={setEditTagLabel}
        onClose={closeEditTag}
        onSave={() => void handleSaveTag()}
        pending={editTagPending}
      />

      <DeleteTagModal
        tag={deletingTag}
        onClose={closeDeleteTag}
        onConfirm={() => void handleConfirmDeleteTag()}
        pending={deleteTagPending}
      />
    </div>
  )
}
