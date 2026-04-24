import type { NoteInput } from "./types";

const toIsoTimestamp = (value: unknown, fieldName: string) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} is required.`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date.`);
  }

  return date.toISOString();
};

const parseTagIds = (value: unknown): number[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("tagIds must be an array of integers.");
  }

  const ids: number[] = [];

  for (const item of value) {
    if (typeof item === "number" && Number.isInteger(item) && item >= 1) {
      ids.push(item);
      continue;
    }

    if (typeof item === "string" && item.trim() !== "") {
      const parsed = Number.parseInt(item, 10);
      if (Number.isInteger(parsed) && parsed >= 1) {
        ids.push(parsed);
        continue;
      }
    }

    throw new Error("tagIds must contain only integers of at least 1.");
  }

  return [...new Set(ids)];
};

const parseCategoryId = (value: unknown): number => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  throw new Error("categoryId must be an integer of at least 1.");
};

export const parseNoteInput = (value: unknown): NoteInput => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Note payload is required.");
  }

  const record = value as Record<string, unknown>;

  return {
    categoryId: parseCategoryId(record.categoryId),
    tagIds: parseTagIds(record.tagIds),
    description:
      typeof record.description === "string" ? record.description : "",
    timeDue: toIsoTimestamp(record.timeDue, "Due time"),
    timeRemind: toIsoTimestamp(record.timeRemind, "Reminder time"),
  };
};
