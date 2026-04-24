---
name: gravity-ui-overlays-toasts
description: Use when implementing modals, dialogs, popups, popovers, drawers, sheets, or toast notifications with @gravity-ui/uikit.
---

# Gravity UI Overlays & Toast Notifications

UIKit provides multiple overlay primitives at different abstraction levels, plus an imperative toast system.

## Overlay Hierarchy

| Component | Use case |
|-----------|----------|
| `Modal` | Low-level full-screen overlay with backdrop. Build custom modals on top of this. |
| `Dialog` | Structured modal with Header/Body/Footer compound components. Use for confirmations, forms. |
| `Popup` | Anchored floating panel (no backdrop). Base for tooltips and popovers. |
| `Popover` | Rich content popup anchored to a trigger element. |
| `Tooltip` | Simple text hint on hover. |
| `ActionTooltip` | Tooltip with a title, description, and optional hotkey display. |
| `Drawer` | Side panel that slides in from the edge of the screen. |
| `Sheet` | Mobile-friendly bottom sheet. |
| `Toaster` | Notification toasts (imperative API). |

## Dialog (Structured Modal)

The most common overlay. Uses compound components for structure:

```tsx
import {Dialog} from '@gravity-ui/uikit';

function ConfirmDialog({open, onClose, onConfirm}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="s"
      aria-labelledby="confirm-title"
    >
      <Dialog.Header caption="Confirm Action" id="confirm-title" />
      <Dialog.Body>
        Are you sure you want to proceed? This action cannot be undone.
      </Dialog.Body>
      <Dialog.Footer
        onClickButtonApply={onConfirm}
        onClickButtonCancel={onClose}
        textButtonApply="Confirm"
        textButtonCancel="Cancel"
      />
    </Dialog>
  );
}
```

### Dialog Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | | Controls visibility |
| `onClose` | `(event, reason) => void` | | Close handler. `reason` can be `"escapeKeyDown"`, `"outsideClick"`, or `"closeButtonClick"` |
| `size` | `"s" \| "m" \| "l"` | | Dialog width |
| `hasCloseButton` | `boolean` | `true` | Show X button in top-right |
| `disableEscapeKeyDown` | `boolean` | `false` | Prevent closing on Escape |
| `disableOutsideClick` | `boolean` | `false` | Prevent closing on backdrop click |
| `keepMounted` | `boolean` | `false` | Keep DOM mounted when closed |
| `contentOverflow` | `"visible" \| "auto"` | `"visible"` | Scroll behavior for tall content |

### Dialog.Footer

| Prop | Type | Description |
|------|------|-------------|
| `onClickButtonApply` | `() => void` | Primary action handler |
| `onClickButtonCancel` | `() => void` | Cancel handler |
| `textButtonApply` | `string` | Primary button label |
| `textButtonCancel` | `string` | Cancel button label |
| `loading` | `boolean` | Shows loading state on apply button |

## Modal (Low-level)

Use when you need a custom modal layout beyond Dialog's structure:

```tsx
import {Modal} from '@gravity-ui/uikit';

<Modal open={isOpen} onClose={() => setOpen(false)}>
  <div style={{padding: 20}}>
    Custom modal content
  </div>
</Modal>
```

## Popup (Anchored Floating Panel)

A positioned floating element without a backdrop. Foundation for tooltips and popovers.

```tsx
import {Popup} from '@gravity-ui/uikit';

function MyPopup() {
  const anchorRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button ref={anchorRef} onClick={() => setOpen(!open)}>Toggle</Button>
      <Popup anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} placement="bottom">
        <div style={{padding: 16}}>Popup content</div>
      </Popup>
    </>
  );
}
```

### Placement Values

`"top"`, `"top-start"`, `"top-end"`, `"bottom"`, `"bottom-start"`, `"bottom-end"`, `"left"`, `"left-start"`, `"left-end"`, `"right"`, `"right-start"`, `"right-end"`.

## Popover

Higher-level than Popup — renders its own trigger and supports rich content:

```tsx
import {Popover} from '@gravity-ui/uikit';

<Popover content="This is a helpful explanation">
  <Button view="flat">Info</Button>
</Popover>
```

## Tooltip / ActionTooltip

```tsx
import {Tooltip, ActionTooltip} from '@gravity-ui/uikit';

<Tooltip content="Save changes">
  <Button view="action">Save</Button>
</Tooltip>

<ActionTooltip title="Bold" hotkey="mod+b" description="Make text bold">
  <Button view="flat"><Icon data={Bold} size={16} /></Button>
</ActionTooltip>
```

## Drawer

Side panel sliding from the screen edge:

```tsx
import {Drawer, DrawerItem} from '@gravity-ui/uikit';

<Drawer onVeilClick={() => setOpen(false)} onEscape={() => setOpen(false)}>
  <DrawerItem id="settings" visible={isOpen} direction="right" width="400px">
    <div style={{padding: 20}}>Drawer content</div>
  </DrawerItem>
</Drawer>
```

## Sheet (Mobile Bottom Sheet)

```tsx
import {Sheet} from '@gravity-ui/uikit';

<Sheet visible={isOpen} onClose={() => setOpen(false)} title="Options">
  <div style={{padding: 20}}>Sheet content</div>
</Sheet>
```

## Toaster (Notifications)

The Toaster is **imperative** — you call methods to create/update/remove toasts.

### Setup

Wrap your app with `ToasterProvider` and render `ToasterComponent`:

```tsx
import {Toaster, ToasterProvider, ToasterComponent} from '@gravity-ui/uikit';

const toaster = new Toaster();

function App() {
  return (
    <ToasterProvider toaster={toaster}>
      <YourApp />
      <ToasterComponent />
    </ToasterProvider>
  );
}
```

### Using the Hook

```tsx
import {useToaster} from '@gravity-ui/uikit';

function SaveButton() {
  const {add} = useToaster();

  const handleSave = async () => {
    try {
      await saveData();
      add({
        name: 'save-ok',
        title: 'Changes saved',
        theme: 'success',
        autoHiding: 3000,
      });
    } catch {
      add({
        name: 'save-err',
        title: 'Save failed',
        content: 'Please try again later.',
        theme: 'danger',
        isClosable: true,
        actions: [{label: 'Retry', onClick: handleSave}],
      });
    }
  };

  return <Button view="action" onClick={handleSave}>Save</Button>;
}
```

### Singleton (Outside React)

For calling toasts outside React components:

```tsx
import {toaster} from '@gravity-ui/uikit/toaster-singleton';

toaster.add({name: 'bg-task', title: 'Upload complete', theme: 'success'});
```

The singleton must share the same `Toaster` instance passed to `ToasterProvider`.

### Toast Options

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | *required* | Unique ID. Duplicate names collapse into one toast. |
| `title` | `string` | | Toast heading |
| `content` | `ReactNode` | | Body content |
| `theme` | `string` | `"normal"` | `"normal"`, `"info"`, `"success"`, `"warning"`, `"danger"`, `"utility"` |
| `autoHiding` | `number \| false` | `5000` | Auto-dismiss delay in ms. `false` to persist. |
| `isClosable` | `boolean` | `true` | Show close button |
| `actions` | `ToastAction[]` | | Action buttons below content |

### Toast Actions

```tsx
{
  label: 'Undo',
  onClick: () => undoAction(),
  view: 'outlined',          // any ButtonView
  removeAfterClick: true,     // dismiss toast after click (default: true)
}
```

### Methods

| Method | Args | Description |
|--------|------|-------------|
| `add(options)` | `ToastOptions` | Show a toast |
| `remove(name)` | `string` | Dismiss by name |
| `removeAll()` | | Dismiss all |
| `update(name, overrides)` | `string, Partial<ToastOptions>` | Update an existing toast |
| `has(name)` | `string` | Check if a toast is displayed |
