import type { ItemDraftPart } from "../types"

export interface StatusDraft {
  selectedStatusId: number | null
}

export const statusPart: ItemDraftPart<StatusDraft> = {
  empty: () => ({ selectedStatusId: null }),
  holds: (draft) => draft.selectedStatusId !== null,
  fromItem: (item) => ({ selectedStatusId: item.status?.id ?? null }),
  toRequest: (draft) => ({ statusId: draft.selectedStatusId }),
  listLabel: (item) => item.status?.label ?? null,
}
