---
name: gravity-ui-table-hocs
description: Use when building data tables with @gravity-ui/uikit Table component. Covers HOC composition for sorting, selection, row actions, copy, and column settings.
---

# Gravity UI Table HOCs

The `Table` component in `@gravity-ui/uikit` is enhanced through Higher-Order Components (HOCs) rather than props. Each HOC adds one capability. Compose them together for the features you need.

## Base Table

```tsx
import {Table} from '@gravity-ui/uikit';

const columns = [
  {id: 'name', name: 'Name'},
  {id: 'status', name: 'Status', template: (item) => <Label theme={item.ok ? 'success' : 'danger'}>{item.status}</Label>},
  {id: 'date', name: 'Created', width: 150, align: 'end'},
];

<Table data={rows} columns={columns} />
```

### Column Config (`TableColumnConfig`)

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Column identifier — also used as default data field key |
| `name` | `string \| () => ReactNode` | Header text |
| `template` | `(item, index) => ReactNode` | Custom cell renderer. Defaults to `item[column.id]` |
| `width` | `number \| string` | Column width |
| `align` | `"start" \| "center" \| "end"` | Content alignment |
| `sticky` | `"start" \| "end"` | Sticky column positioning |
| `primary` | `boolean` | Marks the primary column |
| `placeholder` | `string \| (item, i) => ReactNode` | Fallback for empty cells (default: `—`) |
| `meta` | `Record<string, any>` | Metadata for HOCs (sort config, copy config, etc.) |

## Available HOCs

### withTableSorting

Adds column sort indicators and sort state management.

```tsx
import {Table, withTableSorting} from '@gravity-ui/uikit';

const SortableTable = withTableSorting(Table);

const columns = [
  {id: 'name', meta: {sort: true}},
  {id: 'date', meta: {sort: (a, b) => Date.parse(a.date) - Date.parse(b.date), defaultSortOrder: 'desc'}},
];

// Uncontrolled (internal state)
<SortableTable data={data} columns={columns} />

// Controlled
<SortableTable
  data={data}
  columns={columns}
  sortState={sortState}
  onSortStateChange={setSortState}
/>
```

Column `meta` options:
- `sort: true` — sort by cell value (ascending)
- `sort: (a, b) => number` — custom comparator (return value for ascending order)
- `defaultSortOrder: "asc" | "desc"` — initial sort direction

### withTableActions

Adds a trailing actions column with a kebab menu per row.

```tsx
import {Table, withTableActions} from '@gravity-ui/uikit';

const ActionTable = withTableActions(Table);

<ActionTable
  data={data}
  columns={columns}
  getRowActions={(item) => [
    {text: 'Edit', handler: () => edit(item)},
    {text: 'Delete', handler: () => del(item), theme: 'danger'},
  ]}
/>
```

Action config:
- `text: string` — label
- `handler: (item, index) => void` — click callback
- `theme: "normal" | "danger"` — visual style
- `disabled: boolean`
- `icon: ReactNode` — icon before text
- `href / target / rel` — renders as link

Group actions with `{title: string, items: TableActionConfig[]}`.

### withTableSelection

Adds checkbox selection per row.

```tsx
import {Table, withTableSelection} from '@gravity-ui/uikit';

const SelectableTable = withTableSelection(Table);

function MyTable() {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  return (
    <SelectableTable
      data={data}
      columns={columns}
      getRowId="id"
      selectedIds={selectedIds}
      onSelectionChange={setSelectedIds}
    />
  );
}
```

### withTableCopy

Adds a copy-to-clipboard button on hover per cell.

```tsx
import {Table, withTableCopy} from '@gravity-ui/uikit';

const CopyTable = withTableCopy(Table);

const columns = [
  {id: 'id', meta: {copy: (item) => `ID #${item.id}`}},
  {id: 'name', meta: {copy: true}},  // copies the cell value directly
];
```

### withTableSettings

Adds a column visibility/reorder settings panel.

```tsx
import {Table, withTableSettings} from '@gravity-ui/uikit';

const SettingsTable = withTableSettings({sortable: true, filterable: false})(Table);

function MyTable() {
  const [settings, setSettings] = React.useState([
    {id: 'name', isSelected: true},
    {id: 'date', isSelected: true},
    {id: 'extra', isSelected: false},
  ]);

  return (
    <SettingsTable
      data={data}
      columns={columns}
      settings={settings}
      updateSettings={(s) => { setSettings(s); return Promise.resolve(); }}
    />
  );
}
```

Column `meta` options:
- `selectedByDefault: boolean` — default `true`
- `selectedAlways: boolean` — column cannot be hidden

## Composing Multiple HOCs

Apply HOCs from inside-out. Order matters only when features interact (e.g., actions column should be outermost to stay at the end).

```tsx
import {Table, withTableActions, withTableSorting, withTableSelection, withTableCopy} from '@gravity-ui/uikit';

const MyTable = withTableActions(
  withTableSelection(
    withTableSorting(
      withTableCopy(Table)
    )
  )
);
```

## Other Useful Props

| Prop | Type | Description |
|------|------|-------------|
| `getRowId` | `string \| (item, i) => string` | Row identifier for selection/sorting |
| `getRowDescriptor` | `(item, i) => {disabled?, interactive?, classNames?}` | Per-row styling/behavior |
| `onRowClick` | `(item, i, event) => void` | Row click handler |
| `emptyMessage` | `string` | Message shown when `data` is empty (default: `"No data"`) |
| `verticalAlign` | `"top" \| "middle"` | Cell content vertical alignment |
| `edgePadding` | `boolean` | Adds horizontal padding to first/last columns |
| `stickyHorizontalScroll` | `boolean` | Sticky horizontal scrollbar |
