"use client"

import { useEffect, useRef, useState } from "react"
import { Button, Modal, Select, Text, TextInput } from "@gravity-ui/uikit"
import type { CategoryRecord } from "@lib/db-items"
import type {
  ItemGroupAction,
  ItemGroupActionResponse,
  ItemGroupPreview,
} from "@lib/db-items/contracts/item-group-actions"
import { getCategoryNameError } from "@lib/db-items/contracts/category-name"
import { itemsFetch, readJson, getErrorMessage, RequestError } from "@/lib/api"
import { describeItemGroupContents, planGroupMove } from "@/lib/itemGroupActions"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import styles from "./ItemGroupActionModal.module.css"

interface Props {
  userId: number
  workspaceId: number
  categories: CategoryRecord[]
  prepare: () => Promise<void>
  applied: (result: ItemGroupActionResponse) => void
}

/** A move destination as a select value; the top level has no category id. */
const TOP_LEVEL = "top"

/** Every group kind shares preparation, preview, confirmation and execution. */
export function ItemGroupActionModal({ userId, workspaceId, categories, prepare, applied }: Props) {
  const dialog = useItemsAppStore((state) => state.itemGroupDialog)
  const setDialog = useItemsAppStore((state) => state.setItemGroupDialog)
  const [preview, setPreview] = useState<ItemGroupPreview | null>(null)
  const [label, setLabel] = useState("")
  const [destination, setDestination] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const prepareRef = useRef(prepare)
  const appliedRef = useRef(applied)
  prepareRef.current = prepare
  appliedRef.current = applied
  const contextRef = useRef({ userId, workspaceId, dialog })
  contextRef.current = { userId, workspaceId, dialog }

  useEffect(() => {
    setLabel(dialog && dialog.target.kind !== "uncategorized" ? dialog.label : "")
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
      if (active) setPreview(next)
    })()
      .catch((cause) => {
        if (active) setError(getErrorMessage(cause))
      })
      .finally(() => {
        if (active) setPending(false)
      })
    return () => {
      active = false
    }
  }, [dialog, userId, workspaceId, retry])

  if (!dialog) return null
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
  const execute = async (action: ItemGroupAction) => {
    if (!preview || pending) return
    setPending(true)
    setError(null)
    const isCurrent = () =>
      contextRef.current.userId === userId &&
      contextRef.current.workspaceId === workspaceId &&
      contextRef.current.dialog === dialog
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
      appliedRef.current(result)
      setDialog(null)
    } catch (cause) {
      if (!isCurrent()) return
      setError(getErrorMessage(cause))
      // Never replay a broad selector after a timeout or conflict. The next
      // attempt requires another preview and an explicit confirmation.
      if (!(cause instanceof RequestError) || cause.status !== 400) setPreview(null)
    } finally {
      if (isCurrent()) setPending(false)
    }
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
        {preview && (
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
              Deleting items is permanent.
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
