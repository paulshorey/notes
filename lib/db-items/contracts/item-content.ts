import { hasText } from "./item-capabilities"
import type { ItemRecord } from "./items-app"

/** The current note editor is a text-bearing projection of generic items. */
export const isTextItem = (item: ItemRecord): item is ItemRecord & { description: string } =>
  hasText(item.description)
