---
name: gravity-ui-uikit
description: Use when building React UIs with @gravity-ui/uikit. Covers imports, ThemeProvider setup, component patterns, and library conventions.
---

# Gravity UI UIKit — Agent Guide

`@gravity-ui/uikit` is a React component library (60+ components) built with TypeScript. All components share a consistent API surface around `view`, `size`, `pin`, and CSS-variable overrides.

Docs: https://gravity-ui.com/components/uikit
Storybook: https://preview.gravity-ui.com/uikit/
Icons showcase: https://gravity-ui.com/icons

## Imports

Every component is a named export from the package root:

```tsx
import {Button, TextInput, Select, Dialog, Text, Label} from '@gravity-ui/uikit';
```

Icons come from a separate package:

```tsx
import {Gear, TrashBin, Pencil} from '@gravity-ui/icons';
```

Use the `Icon` wrapper from uikit to render them:

```tsx
import {Icon} from '@gravity-ui/uikit';
import {Gear} from '@gravity-ui/icons';

<Icon data={Gear} size={16} />
```

## Required Setup

### 1. CSS imports (entry point)

```tsx
import '@gravity-ui/uikit/styles/fonts.css';
import '@gravity-ui/uikit/styles/styles.css';
```

### 2. ThemeProvider (required since v6)

The app **must** be wrapped in `ThemeProvider`. Components will not render correctly without it.

```tsx
import {ThemeProvider} from '@gravity-ui/uikit';

<ThemeProvider theme="light">
  <App />
</ThemeProvider>
```

Supported themes: `"light"`, `"dark"`, `"light-hc"` (high-contrast light), `"dark-hc"` (high-contrast dark).

### 3. SSR theme-flash prevention

```tsx
import {getRootClassName} from '@gravity-ui/uikit/server';
const rootClassName = getRootClassName({theme: 'dark'});
// apply rootClassName to <div id="root">
```

### 4. i18n (optional)

```tsx
import {configure} from '@gravity-ui/uikit';
configure({lang: 'en'}); // default is 'en'; also supports 'ru'
```

## Shared Component Conventions

These patterns repeat across nearly every component:

| Prop | Purpose | Typical values |
|------|---------|----------------|
| `size` | Controls height / density | `"xs"`, `"s"`, `"m"` (default), `"l"`, `"xl"` |
| `view` | Visual style variant | `"normal"`, `"action"`, `"flat"`, `"outlined"`, `"clear"` |
| `pin` | Border-radius shape of left/right edges | `"round-round"` (default), `"round-brick"`, `"brick-round"`, `"brick-brick"`, `"circle-clear"`, etc. |
| `disabled` | Disables interaction | `boolean` |
| `loading` | Shows loading indicator | `boolean` |
| `qa` | Sets `data-qa` attribute for testing | `string` |
| `width` | How the component fills its container | `"auto"`, `"max"` |
| `className` | Standard React className | `string` |

### CSS Variable API

Most components expose CSS custom properties for fine-grained styling without overriding classes. The naming convention is `--g-<component>-<property>`:

```css
.my-button {
  --g-button-background-color: #ff0;
  --g-button-text-color: #000;
}
```

### Validation pattern (form controls)

TextInput, TextArea, Select, NumberInput, PasswordInput, PinInput all share:

```tsx
<TextInput
  validationState="invalid"
  errorMessage="Required field"
  errorPlacement="outside" // or "inside"
/>
```

## Component Quick Reference

### Button

```tsx
<Button view="action" size="l">Submit</Button>
<Button view="outlined-danger" size="m" loading>Deleting…</Button>
<Button view="flat" size="s">
  <Icon data={Gear} size={16} />
  Settings
</Button>
```

Views: `normal`, `action`, `raised`, `outlined`, `outlined-action`, `outlined-info`, `outlined-success`, `outlined-warning`, `outlined-danger`, `outlined-utility`, `flat`, `flat-secondary`, `flat-action`, `flat-info`, `flat-success`, `flat-warning`, `flat-danger`, `flat-utility`, `normal-contrast`, `outlined-contrast`, `flat-contrast`.

States: `disabled`, `loading`, `selected`.

### Text

Typography component — always use this instead of raw HTML tags:

```tsx
<Text variant="header-1" color="primary">Title</Text>
<Text variant="body-2" color="secondary" ellipsis>Long content…</Text>
```

Variants: `display-1`..`display-4`, `header-1`..`header-2`, `subheader-1`..`subheader-3`, `body-1`..`body-3`, `body-short`, `caption-1`..`caption-2`, `code-1`..`code-3`.

Colors: `primary`, `secondary`, `complementary`, `hint`, `info`, `positive`, `warning`, `danger`, `utility`, `brand`, `link`, etc.

### TextInput / TextArea / NumberInput / PasswordInput

```tsx
<TextInput
  size="m"
  placeholder="Enter name"
  label="Name"
  hasClear
  startContent={<Icon data={Magnifier} size={16} />}
  onUpdate={(value) => setValue(value)}
/>
```

Key difference: `onUpdate` gives you the raw string value; `onChange` gives the React event. Prefer `onUpdate` for simplicity.

### Select

Two ways to define options — object array or JSX children:

```tsx
// Object array
<Select
  size="m"
  placeholder="Choose…"
  options={[
    {value: 'a', content: 'Option A'},
    {value: 'b', content: 'Option B'},
  ]}
  onUpdate={(values) => setSelected(values)}
/>

// JSX children
<Select multiple filterable placeholder="Tags">
  <Select.OptionGroup label="Fruits">
    <Select.Option value="apple">Apple</Select.Option>
    <Select.Option value="banana">Banana</Select.Option>
  </Select.OptionGroup>
</Select>
```

Built-in list virtualization kicks in at 50+ options (configurable via `virtualizationThreshold`).

### Label

Status badges with optional copy/close actions:

```tsx
<Label theme="success" size="s">Active</Label>
<Label theme="danger" type="close" onCloseClick={handleRemove}>Error</Label>
<Label theme="info" value="42">Count</Label>
```

Themes: `normal`, `info`, `success`, `warning`, `danger`, `utility`, `unknown`, `clear`.

### Dialog

Compound-component pattern with `Dialog.Header`, `Dialog.Body`, `Dialog.Footer`:

```tsx
<Dialog open={isOpen} onClose={() => setOpen(false)} size="m">
  <Dialog.Header caption="Confirm deletion" />
  <Dialog.Body>Are you sure?</Dialog.Body>
  <Dialog.Footer
    onClickButtonApply={handleDelete}
    onClickButtonCancel={() => setOpen(false)}
    textButtonApply="Delete"
    textButtonCancel="Cancel"
  />
</Dialog>
```

### DropdownMenu

```tsx
<DropdownMenu
  items={[
    {text: 'Edit', action: () => edit()},
    {text: 'Delete', action: () => del(), theme: 'danger'},
  ]}
/>
```

Supports nested `items` for submenus, grouped items via nested arrays, and `renderSwitcher` for custom triggers.

### Table

Uses a column-config model with HOC-based enhancement:

```tsx
import {Table, withTableActions, withTableSorting, withTableSelection} from '@gravity-ui/uikit';

const EnhancedTable = withTableSorting(withTableActions(Table));
```

See the dedicated skill file at `.cursor/skills/gravity-ui-table-hocs/SKILL.md` for details on Table HOCs.

### Toaster

Imperative toast API, NOT a declarative component:

```tsx
import {useToaster} from '@gravity-ui/uikit';

function MyComponent() {
  const {add} = useToaster();
  const notify = () => add({
    name: 'save-success',
    title: 'Saved',
    theme: 'success',
    autoHiding: 3000,
  });
}
```

Requires `ToasterProvider` wrapping the app. See `.cursor/skills/gravity-ui-overlays/SKILL.md`.

## Key Differences from Other Libraries

1. **`view` not `variant`**: Gravity uses `view` for visual style on Button, TextInput, Select, etc. This replaces `variant` from MUI/Chakra.
2. **`pin` for border shaping**: Unique system to compose edge styles (`round`, `brick`, `circle`, `clear`) for combining adjacent buttons/inputs.
3. **`onUpdate` vs `onChange`**: Form controls provide `onUpdate(value)` for the plain value alongside standard `onChange(event)`.
4. **CSS variable customization**: Every component exposes `--g-<component>-<prop>` CSS variables. No need for theme object overrides — use CSS directly.
5. **No built-in layout primitives**: There is no `Box`, `Stack`, or `Grid`. Use standard CSS/flex/grid for layout.
6. **Table via HOCs**: Table features (sorting, selection, actions, copy, settings) are composed via HOCs like `withTableSorting(Table)` rather than props.
7. **Toaster is imperative**: Uses `useToaster().add()` / `new Toaster()` rather than declarative `<Toast>` components.
8. **ThemeProvider is mandatory**: Since v6, components require ThemeProvider at the tree root. CSS classes alone are insufficient.
9. **Icons are a separate package**: `@gravity-ui/icons` provides SVGs; UIKit's `<Icon data={...}>` renders them.
