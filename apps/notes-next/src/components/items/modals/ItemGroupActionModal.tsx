"use client"

import { useEffect, useRef, useState } from "react"
import { Button, Modal, Select, Text, TextInput } from "@gravity-ui/uikit"
import type { CategoryRecord, WorkspaceRecord } from "@lib/db-items"
import type {
  ItemGroupAction,
  ItemGroupActionResponse,
  ItemGroupPreview,
} from "@lib/db-items/contracts/item-group-actions"
import { getCategoryNameError } from "@lib/db-items/contracts/category-name"
import { itemsFetch, readJson, getErrorMessage, RequestError } from "@/lib/api"
import {
  FilterablePickerPopup,
  type FilterablePickerOption,
} from "@/components/ui/FilterablePickerPopup"
import { normalizeLabel } from "@/lib/strings"
import { describeItemGroupContents, planGroupMove } from "@/lib/itemGroupActions"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import styles from "./ItemGroupActionModal.module.css"

interface Props {
  userId: number
  workspaceId: number
  categories: CategoryRecord[]
  workspaces: WorkspaceRecord[]
  prepare: () => Promise<void>
  applied: (result: ItemGroupActionResponse) => Promise<void>
  onError: (message: string) => void
}

/** A move destination as a select value; the top level has no category id. */
const TOP_LEVEL = "top"
const CREATE_WORKSPACE = "create-workspace"

/** The destination picker and group modals share preparation, preview, and execution. */
export function ItemGroupActionModal({
  userId,
  workspaceId,
  categories,
  workspaces,
  prepare,
  applied,
  onError,
}: Props) {
  const dialog = useItemsAppStore((state) => state.itemGroupDialog)
  const setDialog = useItemsAppStore((state) => state.setItemGroupDialog)
  const [preview, setPreview] = useState<ItemGroupPreview | null>(null)
  const [label, setLabel] = useState("")
  const pickerInputRef = useRef<HTMLInputElement>(null)
  const [destination, setDestination] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const prepareRef = useRef(prepare)
  const appliedRef = useRef(applied)
  const onErrorRef = useRef(onError)
  prepareRef.current = prepare
  appliedRef.current = applied
  onErrorRef.current = onError
  const contextRef = useRef({ userId, workspaceId })
  contextRef.current = { userId, workspaceId }

  useEffect(() => {
    setLabel(
      dialog && dialog.intent !== "move-to-workspace" && dialog.target.kind !== "uncategorized"
        ? dialog.label
        : "",
    )
    setDestination(null)
  }, [dialog])

  useEffect(() => {
    if (!dialog) return
    let active = true
    setPreview(null)
    setError(null)
    setPending(true)
    void (async () => {
      await prepareRef.current()
      if (!active) return
      const response = await itemsFetch("/api/item-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection: { workspaceId, target: dialog.target } }),
      })
      const next = await readJson<ItemGroupPreview>(response)
      if (!active) return
      if (dialog.intent === "move-to-workspace" && next.itemCount === 0)
        throw new Error("There are no items to move.")
      setPreview(next)
    })()
      .catch((cause) => {
        if (!active || useItemsAppStore.getState().itemGroupDialog !== dialog) return
        if (dialog.intent === "move-to-workspace") {
          onErrorRef.current(getErrorMessage(cause))
          setDialog(null)
        } else setError(getErrorMessage(cause))
      })
      .finally(() => {
        if (active) setPending(false)
      })
    return () => {
      active = false
    }
  }, [dialog, userId, workspaceId, retry, setDialog])

  if (!dialog) return null
  const execute = async (action: ItemGroupAction) => {
    if (!preview || pending) return
    setPending(true)
    setError(null)
    const isCurrent = () =>
      contextRef.current.userId === userId &&
      contextRef.current.workspaceId === workspaceId &&
      useItemsAppStore.getState().itemGroupDialog === dialog
    try {
      const response = await itemsFetch("/api/item-groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selection: { workspaceId, target: dialog.target },
          snapshot: preview.snapshot,
          action,
        }),
      })
      const result = await readJson<ItemGroupActionResponse>(response)
      if (!isCurrent()) return
      await appliedRef.current(result)
      if (
        contextRef.current.userId === userId &&
        useItemsAppStore.getState().itemGroupDialog === dialog
      )
        setDialog(null)
    } catch (cause) {
      if (!isCurrent()) return
      if (dialog.intent === "move-to-workspace") {
        onErrorRef.current(getErrorMessage(cause))
        setDialog(null)
        return
      }
      setError(getErrorMessage(cause))
      // Never replay a broad selector after a timeout or conflict. The next
      // attempt requires another preview and an explicit confirmation.
      if (!(cause instanceof RequestError) || cause.status !== 400) setPreview(null)
    } finally {
      if (isCurrent()) setPending(false)
    }
  }

  if (dialog.intent === "move-to-workspace") {
    const query = normalizeLabel(label)
    const exact = workspaces.find((workspace) => normalizeLabel(workspace.label) === query)
    const inputError = exact?.id === workspaceId ? "Choose a different workspace." : null
    const options: FilterablePickerOption[] = workspaces.filter(
      (workspace) =>
        workspace.id !== workspaceId && normalizeLabel(workspace.label).includes(query),
    )
    if (query && !exact) options.push({ id: CREATE_WORKSPACE, label: `Create “${query}”` })
    const closePicker = () => {
      if ((!pending || !preview) && useItemsAppStore.getState().itemGroupDialog === dialog) {
        setDialog(null)
      }
    }
    const submit = () => {
      if (!query || inputError) return
      void execute(
        exact
          ? { kind: "move-to-workspace", destinationWorkspaceId: exact.id }
          : { kind: "move-to-workspace", destinationWorkspaceLabel: query },
      )
    }
    return (
      <FilterablePickerPopup
        anchorRef={dialog.anchorRef}
        open
        onClose={closePicker}
        placement={["bottom-end", "top-end", "bottom-start", "top-start"]}
        listboxAriaLabel="Destination workspaces"
        description={
          preview && dialog.target.kind !== "item"
            ? `Move the whole group (${describeItemGroupContents(preview)}).`
            : undefined
        }
        options={options}
        disabled={pending && preview !== null}
        input={{
          ref: pickerInputRef,
          value: label,
          placeholder: "Find or create workspace",
          submitDisabled: !preview,
          error: inputError,
          onChange: setLabel,
          onKeyDown: (event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              closePicker()
            } else if (event.key === "Enter") {
              event.preventDefault()
              submit()
            }
          },
          onSubmit: submit,
        }}
        onSelectOption={({ id }) => {
          if (id === CREATE_WORKSPACE) submit()
          else void execute({ kind: "move-to-workspace", destinationWorkspaceId: Number(id) })
        }}
      />
    )
  }

  const uncategorized = dialog.target.kind === "uncategorized"
  const noun = dialog.target.kind === "subcategory" ? "subcategory" : "category"
  const renaming = dialog.intent === "rename"
  const moving = dialog.intent === "move"
  const movePlan = moving ? planGroupMove(categories, dialog.target) : null
  const moveOption =
    movePlan?.options.find(
      (option) =>
        (option.categoryId === null ? TOP_LEVEL : String(option.categoryId)) === destination,
    ) ?? null
  const normalizedLabel = label.trim().toLocaleLowerCase()
  const nameError = getCategoryNameError(label)
  const existing = categories.find((category) => category.label === normalizedLabel)
  const sameName = !uncategorized && normalizedLabel === dialog.label
  const close = () => {
    if (!pending) setDialog(null)
  }
  return (
    <Modal open onClose={close}>
      <div className={styles.modalBody} style={{ maxWidth: 440 }}>
        <Text variant="subheader-2">
          {renaming
            ? `Rename ${dialog.label}`
            : moving
              ? `Move ${dialog.label}`
              : uncategorized
                ? "Delete uncategorized items?"
                : `Delete ${dialog.label}?`}
        </Text>
        {preview && dialog.target.kind !== "item" && (
          <Text variant="body-1">
            {describeItemGroupContents(preview)} in this group across the whole workspace. Display
            filters do not limit this action.
          </Text>
        )}
        {renaming && (
          <>
            <TextInput
              autoFocus
              size="m"
              value={label}
              disabled={pending}
              onUpdate={setLabel}
              placeholder={noun === "subcategory" ? "Subcategory name" : "Category name"}
              validationState={nameError ? "invalid" : undefined}
              errorMessage={nameError ?? undefined}
            />
            {uncategorized && (
              <Text variant="body-1" color="secondary">
                {existing
                  ? `Move these items into the existing “${existing.label}” category.`
                  : "Create this category and move these items into it."}{" "}
                Future notes without a category will still be uncategorized.
              </Text>
            )}
          </>
        )}
        {moving && movePlan && (
          <>
            {movePlan.blocked ? (
              <Text variant="body-1" color="secondary">
                {movePlan.blocked}
              </Text>
            ) : (
              <Select
                size="m"
                width="max"
                placeholder="Choose where it goes"
                disabled={pending}
                value={destination === null ? [] : [destination]}
                onUpdate={(values) => setDestination(values[0] ?? null)}
                options={movePlan.options.map((option) => ({
                  value: option.categoryId === null ? TOP_LEVEL : String(option.categoryId),
                  content: option.label,
                }))}
              />
            )}
            {moveOption && (
              <Text variant="body-1" color={moveOption.conflict ? "danger" : "secondary"}>
                {moveOption.conflict ??
                  (moveOption.categoryId === null
                    ? `“${dialog.label}” becomes a category. Its items keep it as their category.`
                    : noun === "subcategory"
                      ? `“${dialog.label}” becomes a subcategory of “${moveOption.label}”, and its items move with it.`
                      : `“${dialog.label}” becomes a subcategory of “${moveOption.label}”. Its items keep it as their subcategory.`)}
              </Text>
            )}
          </>
        )}
        {!renaming && !moving && preview && (
          <>
            {!uncategorized && (
              <Text variant="body-1" color="secondary">
                {noun === "subcategory"
                  ? "Keeping items removes only this subcategory. Its items stay in the category."
                  : "Keeping items removes only this category. Its items become uncategorized."}
                {preview.subcategoryCount > 0
                  ? ` Its ${preview.subcategoryCount === 1 ? "subcategory is" : `${preview.subcategoryCount} subcategories are`} deleted with it.`
                  : ""}
              </Text>
            )}
            <Text variant="body-1" color="secondary">
              Deleting items is permanent. Empty taxonomy and an empty source workspace are removed.
            </Text>
          </>
        )}
        {error && (
          <Text color="danger" role="alert">
            {error}
          </Text>
        )}
        <div className={styles.modalActions}>
          {!preview && !pending && (
            <Button onClick={() => setRetry((value) => value + 1)}>Refresh preview</Button>
          )}
          {moving ? (
            <Button
              view="action"
              loading={pending}
              disabled={!preview || !moveOption || Boolean(moveOption.conflict)}
              onClick={() =>
                moveOption && void execute({ kind: "move", categoryId: moveOption.categoryId })
              }
            >
              Move {noun}
            </Button>
          ) : renaming ? (
            <Button
              view="action"
              loading={pending}
              disabled={
                !preview ||
                !normalizedLabel ||
                Boolean(nameError) ||
                sameName ||
                (uncategorized && preview.itemCount === 0)
              }
              onClick={() => void execute({ kind: "rename", label: normalizedLabel })}
            >
              {uncategorized ? "Move items to category" : `Rename ${noun}`}
            </Button>
          ) : (
            <>
              {!uncategorized && (
                <Button
                  loading={pending}
                  disabled={!preview}
                  onClick={() => void execute({ kind: "delete", deleteItems: false })}
                >
                  Delete {noun}, keep items
                </Button>
              )}
              <Button
                view="outlined-danger"
                loading={pending}
                disabled={!preview || (uncategorized && preview.itemCount === 0)}
                onClick={() => void execute({ kind: "delete", deleteItems: true })}
              >
                {uncategorized
                  ? "Delete all items in this group"
                  : `Delete ${noun} and all its items`}
              </Button>
            </>
          )}
          <Button view="flat" disabled={pending} onClick={close}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
