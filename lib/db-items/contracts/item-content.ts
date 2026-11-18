import { isKind } from "./item-kinds"
import type { ItemRecord } from "./items-app"

/** The `note` view lists items with text. This narrows them to their text. */
export const isTextItem = (item: ItemRecord): item is ItemRecord & { description: string } =>
  isKind(item, "note")
