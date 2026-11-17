"use client"

import { TextCaptureForm } from "@/components/items/TextCaptureForm"
import { useItemsWorkspace } from "@/workspace/ItemsWorkspaceProvider"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import { EMPTY_PENDING_TAG_LABELS } from "@/workspace/shared"

/**
 * The item editor every view shares, bound to the active entry of the open-item ring.
 * Whichever view shows it, it edits the same entry, so an item opened from two views is
 * one draft.
 */
export function ItemEditor({ onClose }: { onClose?: () => void }) {
  const {
    activeEntry,
    activeForm,
    activeView,
    categories,
    createCategoryPending,
    createStatusPending,
    createTagPending,
    handleAddItemInCategory,
    handleCancelEdit,
    handleCreateCategory,
    handleCreateStatus,
    handleCreateSubcategory,
    handleDeleteItem,
    handleSelectCategory,
    handleSelectStatus,
    handleSelectSubcategory,
    handleTagValuesChange,
    pasteUrlAsMarkdown,
    setActiveForm,
    statuses,
    tags,
    user,
  } = useItemsWorkspace()

  return (
    <TextCaptureForm
      prominent={activeView.editorProminent}
      onClose={onClose}
      form={activeForm}
      setForm={setActiveForm}
      editingItemId={activeEntry?.itemId ?? null}
      userPresent={Boolean(user)}
      pasteUrlAsMarkdown={pasteUrlAsMarkdown}
      categories={categories}
      statuses={statuses}
      tags={tags}
      pendingTagLabels={activeEntry?.pendingTagLabels ?? EMPTY_PENDING_TAG_LABELS}
      // The editor holds one document per entry, named by the entry's uid. A ring key
      // is not enough: each workspace has its own ring, and the first draft in each
      // has the same key, so the editor would keep showing the other workspace's text.
      descriptionEditorSessionId={`${activeEntry?.uid ?? activeEntry?.key ?? "none"}:${activeEntry?.editorSessionId ?? 0}`}
      editorAutofocus={activeEntry?.autofocus ?? false}
      editorRevealText={activeEntry?.revealText ?? null}
      createCategoryPending={createCategoryPending}
      createStatusPending={createStatusPending}
      createTagPending={createTagPending}
      onSelectCategoryId={handleSelectCategory}
      onSelectSubcategoryId={handleSelectSubcategory}
      onCreateSubcategory={handleCreateSubcategory}
      onSelectStatusId={handleSelectStatus}
      onCreateCategory={handleCreateCategory}
      onCreateStatus={handleCreateStatus}
      onTagValuesChange={handleTagValuesChange}
      onCancelEdit={handleCancelEdit}
      onAddItem={handleCancelEdit}
      onAddItemInCategory={handleAddItemInCategory}
      onMoveEditingItem={() => {
        if (activeEntry?.itemId == null) return
        useItemsAppStore.getState().setItemGroupDialog({
          target: { kind: "item", itemId: activeEntry.itemId },
          label: "item",
          intent: "move-to-workspace",
        })
      }}
      onDeleteEditingItem={() => {
        if (activeEntry?.itemId != null) {
          void handleDeleteItem(activeEntry.itemId)
        }
      }}
    />
  )
}
