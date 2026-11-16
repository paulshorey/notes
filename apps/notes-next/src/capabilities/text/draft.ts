import { hasText } from "@lib/db-items/contracts/item-capabilities"
import { itemHeadline } from "@/lib/strings"
import type { ItemDraftPart } from "../types"

export interface TextDraft {
  description: string
}

export const textPart: ItemDraftPart<TextDraft> = {
  empty: () => ({ description: "" }),
  isBlank: (draft) => !hasText(draft.description),
  holds: (draft) => hasText(draft.description),
  fromItem: (item) => ({ description: item.description ?? "" }),
  toRequest: (draft) => ({ description: draft.description }),
  listLabel: (item) => (hasText(item.description) ? itemHeadline(item.description) : null),
}
