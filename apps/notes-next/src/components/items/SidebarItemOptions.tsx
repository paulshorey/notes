"use client"

import type { ItemRecord } from "@lib/db-items"
import { useState, type RefObject } from "react"
import { useItemsWorkspace } from "@/workspace/ItemsWorkspaceProvider"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import { itemDraftFromItem } from "@/capabilities/draftParts"
import type { ScheduleDraft } from "@/capabilities/schedule/draft"
import { toInstant } from "@/lib/dates"
import { normalizeLabel } from "@/lib/strings"
import { EMPTY_PENDING_TAG_LABELS } from "@/workspace/shared"
import { ItemOptionsPanel } from "./ItemOptionsPanel"
import { useItemPickers } from "./useItemPickers"

export function SidebarItemOptions({
  item,
  anchorRef,
  onClose,
}: {
  item: ItemRecord
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const {
    categories,
    tags,
    createCategoryPending,
    createTagPending,
    changeSidebarItem,
    createWorkspaceCategory,
    createWorkspaceSubcategory,
    createWorkspaceStatus,
    resolveWorkspaceTag,
  } = useItemsWorkspace()
  const entry = useItemsAppStore((state) => state.openItems.find((open) => open.itemId === item.id))
  const [pendingSchedule, setPendingSchedule] = useState<{
    due?: Partial<ScheduleDraft>
    remind?: Partial<ScheduleDraft>
  }>({})
  const form = {
    ...(entry?.form ?? itemDraftFromItem(item)),
    ...pendingSchedule.due,
    ...pendingSchedule.remind,
  }
  const categoryId = form.selectedCategoryId
  const pickers = useItemPickers({
    form,
    userPresent: true,
    categories,
    tags,
    createCategoryPending,
    createTagPending,
    pendingTagLabels: entry?.pendingTagLabels ?? EMPTY_PENDING_TAG_LABELS,
    onSelectFiling: async (filing) => {
      await changeSidebarItem(item, () => filing)
    },
    onSelectSubcategoryId: async (rawId) => {
      const subcategoryId = Number(rawId) || null
      await changeSidebarItem(item, () => ({
        categoryId,
        subcategoryId: form.selectedSubcategoryId === subcategoryId ? null : subcategoryId,
      }))
    },
    onCreateCategory: async (label) => {
      await changeSidebarItem(item, async () => {
        const category = await createWorkspaceCategory(label)
        return category ? { categoryId: category.id, subcategoryId: null } : {}
      })
    },
    onCreateSubcategory: async (label) => {
      await changeSidebarItem(item, async () => {
        const subcategoryId = await createWorkspaceSubcategory(categoryId, label)
        return subcategoryId === null ? {} : { categoryId, subcategoryId }
      })
    },
    onTagValuesChange: async (labels, changedLabel) => {
      const selected = labels.some(
        (label) => normalizeLabel(label) === normalizeLabel(changedLabel),
      )
      await changeSidebarItem(item, async (current) => {
        const kept = current.tags.filter(
          (tag) => normalizeLabel(tag.label) !== normalizeLabel(changedLabel),
        )
        const tag = selected ? await resolveWorkspaceTag(changedLabel) : null
        return { tagIds: [...kept.map((tag) => tag.id), ...(tag ? [tag.id] : [])] }
      })
    },
  })
  return (
    <ItemOptionsPanel
      itemId={item.id}
      anchorRef={anchorRef}
      onClose={onClose}
      form={form}
      pickers={pickers}
      onSelectStatusId={async (rawId) => {
        await changeSidebarItem(item, () => ({ statusId: Number(rawId) || null }))
      }}
      onCreateStatus={async (label) => {
        await changeSidebarItem(item, async () => {
          const statusId = await createWorkspaceStatus(label)
          return statusId === null ? {} : { statusId }
        })
      }}
      onScheduleChange={(update) => {
        const patch = update(form)
        const due = "timeDue" in patch
        const field = due ? "due" : "remind"
        setPendingSchedule((current) => ({ ...current, [field]: patch }))
        void changeSidebarItem(item, () =>
          due ? { timeDue: toInstant(patch.timeDue) } : { timeRemind: toInstant(patch.timeRemind) },
        ).then(() => {
          setPendingSchedule((current) =>
            current[field] === patch ? { ...current, [field]: undefined } : current,
          )
        })
      }}
    />
  )
}
