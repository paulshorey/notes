import { ITEM_CAPABILITIES, type ItemCapabilityKey } from "../../contracts/item-capabilities"

/**
 * How one part of an item is stored and carried between accounts.
 *
 * `fields` are the part's entries in a backup item. Each is read with `export`, an
 * expression over the item row `n`, and written with `import`, a column assignment
 * from the staged backup row `n` into the workspace `$1`. A field counts toward
 * duplicate detection unless it sets `identity: false`.
 *
 * `rehome` re-points columns that reference a row of the item's workspace when the
 * item moves to workspace `$1`: the expression finds the row with the same label there.
 */
export interface StoredItemPart {
  /**
   * For a capability: an SQL condition over the item row `n` that is true when the
   * item holds it. It mirrors `isPresent` in the browser-safe half of the registry.
   */
  present?: string
  /** Columns of workspace_item_v1 this part owns. */
  columns: readonly string[]
  /** Tables with a foreign key to workspace_item_v1 this part owns, by table name. */
  tables: Record<string, StoredItemTable>
  fields: Record<
    string,
    { type: string; export: string; import?: Record<string, string>; identity?: false }
  >
  rehome?: Record<string, string>
}

/**
 * A table of rows that belong to items. Owning one means carrying its rows everywhere
 * the item goes, so a table cannot be declared without saying how.
 */
export interface StoredItemTable {
  /** The backup field of the same part whose `export` reads this table's rows. */
  field: string
  /**
   * Writes the rows of restored items: the body of a data-modifying statement that
   * reads the staged backup rows `items` (joined to `inserted` for the ids written)
   * in workspace `$1`.
   */
  import: string
  /**
   * Needed only when a row also points into the item's workspace, so it cannot simply
   * follow its item to another one. `detach` removes the rows of the `moved` items and
   * returns what `attach` needs to write them again for workspace `$1`; `attach`
   * receives the name of the relation holding those returned rows.
   */
  rehome?: { detach: string; attach: (detached: string) => string }
}

const labelIn = (table: string, workspace: string, label: string) =>
  `(SELECT d.id FROM public.${table} d WHERE d.workspace_id=${workspace} AND d.label=${label})`

/** Identity and ownership: present on every item, never content. */
export const ITEM_CORE: StoredItemPart = {
  columns: ["id", "uid", "workspace_id", "time_created", "time_modified"],
  tables: {},
  fields: {
    // A restored item keeps its uid when no item has it. A uid that is taken, here or
    // by an earlier item of the same backup, means this is a second copy, which gets
    // its own. It never decides whether two items are the same: content does.
    uid: {
      type: "uuid",
      export: "n.uid",
      import: {
        uid: `COALESCE((SELECT n.uid WHERE NOT EXISTS (
            SELECT 1 FROM public.workspace_item_v1 taken WHERE taken.uid=n.uid)
          AND NOT EXISTS (SELECT 1 FROM items earlier WHERE earlier.uid=n.uid AND earlier.id<n.id)),
          gen_random_uuid())`,
      },
      identity: false,
    },
    timeCreated: {
      type: "timestamptz",
      export: "n.time_created",
      import: { time_created: `n."timeCreated"` },
    },
    // An edit that leaves the same content must not make an item look new.
    timeModified: {
      type: "timestamptz",
      export: "n.time_modified",
      import: { time_modified: `n."timeModified"` },
      identity: false,
    },
  },
}

/** Where the item is filed. Tags are links to the workspace's tags, matched by label. */
export const ITEM_TAXONOMY: StoredItemPart = {
  columns: ["category_id", "subcategory_id"],
  tables: {
    item_tag_link_v1: {
      field: "tags",
      import: `INSERT INTO public.item_tag_link_v1(item_id,tag_id,workspace_id)
        SELECT n.id,t.id,$1 FROM items n JOIN inserted i ON i.id=n.id
        CROSS JOIN LATERAL unnest(n.tags) labels(label)
        JOIN public.workspace_tag_v1 t ON t.workspace_id=$1 AND t.label=labels.label`,
      rehome: {
        detach: `DELETE FROM public.item_tag_link_v1 l USING moved m WHERE l.item_id=m.id
          RETURNING l.item_id,l.tag_id`,
        attach: (detached) => `INSERT INTO public.item_tag_link_v1(item_id,tag_id,workspace_id)
          SELECT o.item_id,dt.id,$1 FROM ${detached} o
          JOIN public.workspace_tag_v1 st ON st.id=o.tag_id
          JOIN public.workspace_tag_v1 dt ON dt.workspace_id=$1 AND dt.label=st.label`,
      },
    },
  },
  fields: {
    category: {
      type: "text",
      export: `(SELECT c.label FROM public.workspace_category_v1 c WHERE c.id=n.category_id)`,
      import: { category_id: labelIn("workspace_category_v1", "$1", "n.category") },
    },
    subcategory: {
      type: "text",
      export: `(SELECT sc.label FROM public.workspace_subcategory_v1 sc WHERE sc.id=n.subcategory_id)`,
      import: {
        subcategory_id: `(SELECT sc.id FROM public.workspace_subcategory_v1 sc
          JOIN public.workspace_category_v1 c ON c.id=sc.category_id
          WHERE c.workspace_id=$1 AND c.label=n.category AND sc.label=n.subcategory)`,
      },
    },
    tags: {
      type: "text[]",
      export: `ARRAY(SELECT t.label FROM public.item_tag_link_v1 l
        JOIN public.workspace_tag_v1 t ON t.id=l.tag_id WHERE l.item_id=n.id ORDER BY t.label)`,
    },
  },
  rehome: {
    category_id: `(SELECT d.id FROM public.workspace_category_v1 s
      JOIN public.workspace_category_v1 d ON d.workspace_id=$1 AND d.label=s.label
      WHERE s.id=n.category_id)`,
    subcategory_id: `(SELECT dsub.id FROM public.workspace_subcategory_v1 ssub
      JOIN public.workspace_category_v1 sc ON sc.id=ssub.category_id
      JOIN public.workspace_category_v1 dc ON dc.workspace_id=$1 AND dc.label=sc.label
      JOIN public.workspace_subcategory_v1 dsub ON dsub.category_id=dc.id AND dsub.label=ssub.label
      WHERE ssub.id=n.subcategory_id)`,
  },
}

/**
 * The server half of the capability registry (`contracts/item-capabilities.ts` is the
 * browser-safe half). Backup export, backup import, duplicate detection, and account
 * merge are built from these entries, so a capability declared here is carried by all
 * of them, and one that is not declared fails `db:verify`.
 */
export const STORED_ITEM_CAPABILITIES: Record<ItemCapabilityKey, StoredItemPart> = {
  text: {
    // Text counts when it has a character that JavaScript's `trim` would keep, which is
    // what `hasText` decides. The whitespace is listed, because the regular expression
    // classes for it follow the database's collation and differ between providers.
    present: String.raw`COALESCE(n.description,'') ~ '[^\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'`,
    columns: ["description"],
    tables: {},
    fields: {
      description: {
        type: "text",
        export: "n.description",
        import: { description: "n.description" },
      },
    },
  },
  schedule: {
    present: `(n.time_due IS NOT NULL OR n.time_remind IS NOT NULL)`,
    columns: ["time_due", "time_remind"],
    tables: {},
    fields: {
      timeDue: { type: "timestamptz", export: "n.time_due", import: { time_due: `n."timeDue"` } },
      timeRemind: {
        type: "timestamptz",
        export: "n.time_remind",
        import: { time_remind: `n."timeRemind"` },
      },
    },
  },
  status: {
    present: `n.status_id IS NOT NULL`,
    columns: ["status_id"],
    tables: {},
    fields: {
      status: {
        type: "text",
        export: `(SELECT s.label FROM public.workspace_status_v1 s WHERE s.id=n.status_id)`,
        import: { status_id: labelIn("workspace_status_v1", "$1", "n.status") },
      },
    },
    rehome: {
      status_id: `(SELECT d.id FROM public.workspace_status_v1 s
        JOIN public.workspace_status_v1 d ON d.workspace_id=$1 AND d.label=s.label
        WHERE s.id=n.status_id)`,
    },
  },
}

/**
 * Item storage that is neither identity, taxonomy, nor a capability. Derived data is
 * rebuilt from content and never backed up; it stays on the row when an item moves.
 */
export const ITEM_DERIVED_COLUMNS = [
  "description_embedding",
  "embedding_model",
  "embedding_updated_at",
] as const

const STORED_PARTS: readonly StoredItemPart[] = [
  ITEM_CORE,
  ITEM_TAXONOMY,
  ...Object.values(STORED_ITEM_CAPABILITIES),
]

/** Every item column and item-referencing table that some part accounts for. */
export const ITEM_STORAGE_OWNERS = {
  columns: [...STORED_PARTS.flatMap((part) => part.columns), ...ITEM_DERIVED_COLUMNS],
  tables: STORED_PARTS.flatMap((part) => Object.keys(part.tables)),
}

/**
 * True for an item row `n` that holds content: at least one capability whose role is
 * content. It is the save rule (`hasItemContent`) over a stored row.
 */
export const ITEM_HAS_CONTENT_SQL = `(${ITEM_CAPABILITIES.filter(
  (capability) => capability.role === "content",
)
  .map((capability) => STORED_ITEM_CAPABILITIES[capability.key].present)
  .join(" OR ")})`

const quoted = (name: string) => `"${name}"`
const allFields = STORED_PARTS.flatMap((part) => Object.entries(part.fields))

/** The backup fields that decide whether two items are the same item. */
export const ITEM_IDENTITY_FIELDS = allFields
  .filter(([, field]) => field.identity !== false)
  .map(([name]) => name)

const portableFields = allFields
  .map(([name, field]) => `${field.export} AS ${quoted(name)}`)
  .join(",\n  ")

/** One row per item of workspace `$1`, with every backup field under its own name. */
export const PORTABLE_ITEMS_SQL = `SELECT n.id,${portableFields}
  FROM public.workspace_item_v1 n WHERE n.workspace_id=$1 ORDER BY n.id`

/**
 * Delete the items `$1` that belong to user `$2` (in workspace `$3` when it is given),
 * keeping each in the trash as its backup fields. It is one statement, so the trash
 * holds exactly the rows that were deleted. Returns the deleted ids.
 */
export const TRASH_ITEMS_SQL = `WITH doomed AS MATERIALIZED (
    SELECT n.id FROM public.workspace_item_v1 n
    JOIN public.user_workspace_v1 w ON w.id=n.workspace_id
    WHERE n.id=ANY($1::int[]) AND w.user_id=$2 AND ($3::int IS NULL OR n.workspace_id=$3)
  ), trashed AS (
    INSERT INTO public.user_item_trash_v1(user_id,workspace_id,workspace_label,item)
    SELECT $2,p.workspace_id,p.workspace_label,to_jsonb(p)-'id'-'workspace_id'-'workspace_label'
    FROM (SELECT n.id,n.workspace_id,
        (SELECT w.label FROM public.user_workspace_v1 w WHERE w.id=n.workspace_id) workspace_label,
        ${portableFields}
      FROM public.workspace_item_v1 n JOIN doomed d ON d.id=n.id) p
  )
  DELETE FROM public.workspace_item_v1 n USING doomed d WHERE n.id=d.id RETURNING n.id`

const imported = allFields.flatMap(([, field]) => Object.entries(field.import ?? {}))

const ownedTables = STORED_PARTS.flatMap((part) => Object.entries(part.tables))

/** Every table a part owns, with whether it declares how its rows follow a moved item. */
export const ITEM_OWNED_TABLES: Record<string, { rehomed: boolean }> = Object.fromEntries(
  ownedTables.map(([name, table]) => [name, { rehomed: Boolean(table.rehome) }]),
)

/**
 * Backup fields that restore writes nowhere: no `import` column assignment, and no owned
 * table whose `field` names them. Exporting such a field would lose its value on restore.
 */
export const findUnrestoredFields = (parts: readonly StoredItemPart[] = STORED_PARTS) => {
  const tableFields = new Set(
    parts.flatMap((part) => Object.values(part.tables)).map((t) => t.field),
  )
  return parts
    .flatMap((part) => Object.entries(part.fields))
    .filter(
      ([name, field]) => Object.keys(field.import ?? {}).length === 0 && !tableFields.has(name),
    )
    .map(([name]) => name)
}

/**
 * Restore the backup items in `$2` (a JSON array) as items of workspace `$1`: one
 * statement stages every item with a new id, writes the item rows, then writes each
 * owned table's rows. Those depend on the new ids, and running in the same statement
 * lets their foreign keys see the items it wrote. Returns the new ids.
 */
export const IMPORT_ITEMS_SQL = `WITH items AS MATERIALIZED (
    SELECT nextval(pg_get_serial_sequence('public.workspace_item_v1','id'))::int id,v.*
    FROM jsonb_to_recordset($2::jsonb) v(${allFields
      .map(([name, field]) => `${quoted(name)} ${field.type}`)
      .join(",")})
  ), inserted AS (
    INSERT INTO public.workspace_item_v1(id,workspace_id,${imported.map(([column]) => column).join(",")})
    SELECT n.id,$1,${imported.map(([, value]) => value).join(",\n      ")}
    FROM items n
    RETURNING id
  )${ownedTables.map(([name, table]) => `, ${quoted(`${name}_rows`)} AS (\n    ${table.import}\n  )`).join("")}
  SELECT id FROM inserted ORDER BY id`

const rehomed = STORED_PARTS.flatMap((part) => Object.entries(part.rehome ?? {}))
const rehomedTables = ownedTables.flatMap(([name, table]) =>
  table.rehome ? [{ name, ...table.rehome }] : [],
)

/**
 * Move selected items (`$3`, null for all) from workspace `$2` to `$1`, except the ids in `$4`. The rows
 * keep their ids, so everything keyed only by item id comes along untouched. Columns
 * that point into the old workspace are re-pointed by label, and tables whose rows do
 * the same are detached and attached again. It is one statement, so the composite
 * foreign keys are checked once, against the final state. Returns the moved ids.
 */
export const MOVE_ITEMS_SQL = `WITH moved AS MATERIALIZED (
    SELECT n.id FROM public.workspace_item_v1 n
    WHERE n.workspace_id=$2 AND ($3::int[] IS NULL OR n.id=ANY($3)) AND n.id<>ALL($4::int[])
  )${rehomedTables.map(({ name, detach }) => `, ${quoted(`${name}_detached`)} AS (\n    ${detach}\n  )`).join("")}, updated AS (
    UPDATE public.workspace_item_v1 n SET workspace_id=$1,
      ${rehomed.map(([column, value]) => `${column}=${value}`).join(",\n      ")}
    FROM moved m WHERE n.id=m.id
    RETURNING n.id
  )${rehomedTables.map(({ name, attach }) => `, ${quoted(`${name}_attached`)} AS (\n    ${attach(quoted(`${name}_detached`))}\n  )`).join("")}
  SELECT id FROM updated ORDER BY id`
