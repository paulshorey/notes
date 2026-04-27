// AUTO-GENERATED FILE. DO NOT EDIT.
// Run: pnpm --filter @lib/db-marketing db:types:generate

export interface UserNoteCategoryV1Row {
  "id": number;
  "user_id": number;
  "label": string;
  "time_created": Date;
  "time_modified": Date;
  "category_embedding": string | null;
  "embedding_model": string | null;
  "embedding_updated_at": Date | null;
}

export interface UserNoteTagLinkV1Row {
  "note_id": number;
  "tag_id": number;
}

export interface UserNoteTagV1Row {
  "id": number;
  "user_id": number;
  "label": string;
  "time_created": Date;
  "time_modified": Date;
  "tag_embedding": string | null;
  "embedding_model": string | null;
  "embedding_updated_at": Date | null;
}

export interface UserNoteV1Row {
  "id": number;
  "user_id": number;
  "description": string | null;
  "time_due": Date | null;
  "time_remind": Date | null;
  "time_created": Date;
  "time_modified": Date;
  "embedding_model": string | null;
  "embedding_updated_at": Date | null;
  "description_embedding": string | null;
  "category_id": number;
}

export interface UserV1Row {
  "id": number;
  "username": string;
  "email": string | null;
  "phone": string | null;
  "time_created": Date;
  "time_modified": Date;
  "preferences": unknown;
}

export interface PostgresDbSchema {
  "user_note_category_v1": UserNoteCategoryV1Row;
  "user_note_tag_link_v1": UserNoteTagLinkV1Row;
  "user_note_tag_v1": UserNoteTagV1Row;
  "user_note_v1": UserNoteV1Row;
  "user_v1": UserV1Row;
}
