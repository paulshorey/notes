"use client"

import { useRouter } from "next/navigation"
import { isKind } from "@lib/db-items/contracts/item-kinds"
import type { ReactNode } from "react"
import { Button, Text } from "@gravity-ui/uikit"
import { readItemsUrlSelection } from "@/lib/itemsUrlSelection"
import { FeedbackNotifications } from "@/components/items/FeedbackNotifications"
import { ResultsColumn } from "@/components/items/ResultsColumn"
import { WorkspaceHeader } from "@/components/items/WorkspaceHeader"
import { DeleteTagModal } from "@/components/items/modals/DeleteTagModal"
import { EditTagModal } from "@/components/items/modals/EditTagModal"
import { DeleteWorkspaceModal } from "@/components/items/modals/DeleteWorkspaceModal"
import { ItemGroupActionModal } from "@/components/items/modals/ItemGroupActionModal"
import { TRASH_RETENTION_DAYS } from "@lib/db-items/contracts/item-model"
import { FilterablePicker } from "@/components/ui/FilterablePicker"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import { useItemsWorkspace } from "@/workspace/ItemsWorkspaceProvider"
import styles from "./AppShell.module.css"

/**
 * What every view shares: the workspace header, the taxonomy sidebar, notifications,
 * and the dialogs that act on the workspace. The active view renders as `children`
 * in the main column.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const {
    activeView,
    activateEntryInStore,
    activeEntry,
    activeForm,
    activeKey,
    activeWorkspaceId,
    anonymousSignInPending,
    applyItemGroupAction,
    authPending,
    authSession,
    authStatus,
    backupOperation,
    categories,
    categoryItemGroups,
    closeDeleteTag,
    closeEditTag,
    contentRef,
    createCategoryPending,
    createWorkspaceCategory,
    deleteTagPending,
    deletingTag,
    editTagLabel,
    editTagPending,
    editingTag,
    embeddingMaintenancePending,
    errorMessage,
    saveConflictItem,
    setSaveConflictItem,
    keepEntryOverStoredItem,
    fallbackTagId,
    filingLabelFor,
    handleAddItemForCategory,
    handleAddItemForTag,
    handleCancelEdit,
    handleCloseOpenItem,
    handleConfirmDeleteTag,
    handleCreateWorkspace,
    handleRequestDeleteWorkspace,
    handleConfirmDeleteWorkspace,
    handleCancelDeleteWorkspace,
    workspaceDeletion,
    handleDownloadBackup,
    handleLogin,
    handleLogout,
    handleMaxOpenItemsChange,
    handleOpenItemFromResults,
    handlePasteUrlAsMarkdownChange,
    handleResizePointerCancel,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerUp,
    handleRestoreBackup,
    handleItemRestored,
    handleResultsOverlayClick,
    handleRunEmbeddingMaintenance,
    handleSaveTag,
    handleSignup,
    handleSwitchWorkspace,
    identifier,
    itemsLoading,
    maxOpenItems,
    noStatusItems,
    openDeleteTag,
    openEditTag,
    openItemIds,
    password,
    pasteUrlAsMarkdown,
    preferredResultsColumnWidth,
    prepareItemGroupAction,
    resultsColumnStyle,
    resultsListVisible,
    resultsOverlayMounted,
    searchErrorMessage,
    searchItems,
    searchLoading,
    searchMode,
    selectedTag,
    sessionLoading,
    setEditTagLabel,
    setErrorMessage,
    setIdentifier,
    setPassword,
    setSearchErrorMessage,
    setStartupRetryKey,
    setStatusMessage,
    startupErrorMessage,
    statusItemGroups,
    statusMessage,
    statuses,
    tagItemGroups,
    tags,
    updateResultsColumnWidth,
    user,
    workspaces,
  } = useItemsWorkspace()

  const workspaceMoveOpen = useItemsAppStore(
    (state) => state.itemGroupDialog?.intent === "move-to-workspace",
  )

  if (authStatus === "loading" || sessionLoading || !user) {
    return (
      <div className={styles.page}>
        {startupErrorMessage ? (
          <div className={styles.startupState} role="alert">
            <Text variant="body-1" color="danger">
              {startupErrorMessage}
            </Text>
            <Button
              view="action"
              size="m"
              loading={anonymousSignInPending}
              onClick={() => setStartupRetryKey((key) => key + 1)}
            >
              Retry
            </Button>
            {readItemsUrlSelection().hasItemTarget ? (
              <Button href={window.location.pathname}>Open workspace</Button>
            ) : null}
          </div>
        ) : (
          <div className={styles.startupState} aria-live="polite">
            <Text variant="body-1" color="secondary">
              Loading…
            </Text>
          </div>
        )}
      </div>
    )
  }

  const activeWorkspace = workspaces.find(
    (workspace) => workspace.id === (activeWorkspaceId ?? workspaces[0]?.id),
  )
  const workspaceLabel = activeWorkspace?.label ?? "Workspace"

  return (
    <div className={styles.page}>
      <FeedbackNotifications
        saveConflictItem={saveConflictItem}
        onDismissConflict={() => setSaveConflictItem(null)}
        onKeepConflictingEdits={keepEntryOverStoredItem}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
        searchErrorMessage={searchErrorMessage}
        onDismissStatus={() => setStatusMessage(null)}
        onDismissError={() => setErrorMessage(null)}
        onDismissSearchError={() => setSearchErrorMessage(null)}
      />

      <div
        className={styles.content}
        ref={contentRef}
        inert={backupOperation !== null || workspaceMoveOpen}
      >
        <div className={styles.editorColumn}>
          <div className={styles.header}>
            <WorkspaceHeader
              onDownloadBackup={handleDownloadBackup}
              onRestoreBackup={handleRestoreBackup}
              onItemRestored={handleItemRestored}
              user={user}
              isAnonymous={authSession?.user?.isAnonymous ?? false}
              resultsListVisible={resultsListVisible}
              pasteUrlAsMarkdown={pasteUrlAsMarkdown}
              onPasteUrlAsMarkdownChange={handlePasteUrlAsMarkdownChange}
              onAddItem={handleCancelEdit}
              onLogout={handleLogout}
              maxOpenItems={maxOpenItems}
              onMaxOpenItemsChange={handleMaxOpenItemsChange}
              filingLabelFor={filingLabelFor}
              onSelectOpenItem={activateEntryInStore}
              onCloseOpenItem={handleCloseOpenItem}
              embeddingMaintenancePending={embeddingMaintenancePending}
              onRunEmbeddingMaintenance={(mode) => void handleRunEmbeddingMaintenance(mode)}
              identifier={identifier}
              password={password}
              onIdentifierChange={setIdentifier}
              onPasswordChange={setPassword}
              onLoginSubmit={handleLogin}
              onSignupSubmit={handleSignup}
              authPending={authPending}
              loginErrorMessage={authPending ? null : errorMessage}
              onDismissLoginError={() => setErrorMessage(null)}
            />
          </div>

          {children}
        </div>

        {resultsOverlayMounted && (
          <button
            type="button"
            className={`${styles.resultsOverlay} ${
              resultsListVisible ? "" : styles.resultsOverlayClosing
            }`}
            aria-label="Hide notes list"
            onClick={handleResultsOverlayClick}
          />
        )}

        <button
          type="button"
          className={styles.resizeHandle}
          aria-label="Resize notes list"
          title="Drag or use arrow keys to resize notes list"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerCancel}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault()
              updateResultsColumnWidth(
                preferredResultsColumnWidth + (event.key === "ArrowLeft" ? 16 : -16),
              )
            }
          }}
        />

        <ResultsColumn
          visible={resultsListVisible}
          columnStyle={resultsColumnStyle}
          workspaceId={activeWorkspaceId}
          workspacePicker={
            <FilterablePicker
              variant="prominent"
              value={workspaceLabel}
              triggerClassName={styles.workspacePickerTrigger}
              triggerSuffix="space"
              triggerAriaLabel={`Current workspace, ${workspaceLabel}`}
              listboxAriaLabel="Workspace options"
              options={workspaces}
              selectedIds={activeWorkspace ? [activeWorkspace.id] : []}
              onSelectOption={(workspace) => handleSwitchWorkspace(Number(workspace.id))}
              onCreateOption={handleCreateWorkspace}
              onDeleteOption={(workspace) =>
                void handleRequestDeleteWorkspace(Number(workspace.id))
              }
              deleteOptionAriaLabel={(workspace) => `Delete workspace ${workspace.label}`}
              emptyWithoutQueryMessage="No workspaces yet"
              inputPlaceholder="Enter new workspace..."
              placement={["bottom-start", "bottom-end", "top-start", "top-end"]}
            />
          }
          tags={tags}
          itemsLoading={itemsLoading}
          categories={categories}
          createCategoryPending={createCategoryPending}
          onCreateCategory={createWorkspaceCategory}
          statuses={statuses}
          statusItemGroups={statusItemGroups}
          activeStatusId={activeForm.selectedStatusId}
          fallbackTagId={fallbackTagId}
          selectedTag={selectedTag}
          searchMode={searchMode}
          searchItems={searchItems}
          searchLoading={searchLoading}
          categoryItemGroups={categoryItemGroups}
          noStatusItems={noStatusItems}
          tagItemGroups={tagItemGroups}
          activeItemId={activeEntry?.itemId ?? null}
          openItemIds={openItemIds}
          activeKey={activeKey}
          activeCategoryId={activeForm.selectedCategoryId}
          activeSubcategoryId={activeForm.selectedSubcategoryId}
          activeTagIds={activeForm.selectedTagIds}
          onEditItem={(item) => {
            handleOpenItemFromResults(item)
            if (activeView.kind === "time" && !isKind(item, "time"))
              router.push(`/?item=${item.uid}`)
          }}
          onAddItemForCategory={handleAddItemForCategory}
          onAddItemForTag={handleAddItemForTag}
          onEditTag={openEditTag}
          onDeleteTag={openDeleteTag}
        />
      </div>

      {workspaceDeletion && (
        <DeleteWorkspaceModal
          workspace={workspaceDeletion.workspace}
          items={workspaceDeletion.items}
          retentionDays={TRASH_RETENTION_DAYS}
          pending={workspaceDeletion.pending}
          error={workspaceDeletion.error}
          onClose={handleCancelDeleteWorkspace}
          onConfirm={() => void handleConfirmDeleteWorkspace()}
        />
      )}
      {user !== null && activeWorkspaceId !== null && (
        <ItemGroupActionModal
          userId={user.id}
          workspaceId={activeWorkspaceId}
          categories={categories}
          workspaces={workspaces}
          prepare={prepareItemGroupAction}
          applied={applyItemGroupAction}
          onError={setErrorMessage}
        />
      )}

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
