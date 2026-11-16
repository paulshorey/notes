import { isKind } from "./item-kinds"
import type { ItemRecord } from "./items-app"

/** The Notes view lists the items of kind "note". This narrows them to their text. */
export const isTextItem = (item: ItemRecord): item is ItemRecord & { description: string } =>
  isKind(item, "note")
