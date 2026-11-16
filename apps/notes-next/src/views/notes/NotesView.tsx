"use client"

import { TextCaptureForm } from "@/components/items/TextCaptureForm"
import { useItemsWorkspace } from "@/workspace/ItemsWorkspaceProvider"
import { EMPTY_PENDING_TAG_LABELS } from "@/workspace/shared"

/** The Notes view: the text editor for the active entry of the open-item ring. */
export function NotesView() {
  const {
    activeEntry,
    activeForm,
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
      form={activeForm}
      setForm={setActiveForm}
      editingItemId={activeEntry?.itemId ?? null}
      userPresent={Boolean(user)}
      pasteUrlAsMarkdown={pasteUrlAsMarkdown}
      categories={categories}
      statuses={statuses}
      tags={tags}
      pendingTagLabels={activeEntry?.pendingTagLabels ?? EMPTY_PENDING_TAG_LABELS}
      // Keying the editor on the entry as well as the session id is what
      // makes switching notes swap documents: same entry, same document.
      descriptionEditorSessionId={`${activeEntry?.key ?? "none"}:${activeEntry?.editorSessionId ?? 0}`}
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
      onDeleteEditingItem={() => {
        if (activeEntry?.itemId != null) {
          void handleDeleteItem(activeEntry.itemId)
        }
      }}
    />
  )
}
