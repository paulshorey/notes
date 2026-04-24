# Gravity UI UIKit

A React component library with 60+ production-ready UI components. Built with TypeScript, supports light/dark themes, and provides CSS-variable-based customization.

- **Docs**: https://gravity-ui.com/components/uikit
- **Storybook**: https://preview.gravity-ui.com/uikit/
- **Themer** (visual theme editor): https://gravity-ui.com/themer
- **Icons showcase**: https://gravity-ui.com/icons

## Installation

```bash
# Core UI components
pnpm add @gravity-ui/uikit

# Icon pack (optional but recommended)
pnpm add @gravity-ui/icons
```

### Peer dependencies

UIKit requires React 18+:

```bash
pnpm add react react-dom
```

## Setup

### 1. Import base styles

Add these imports **once** at your application entry point (e.g. `_app.tsx`, `index.tsx`, or `layout.tsx`):

```tsx
import '@gravity-ui/uikit/styles/fonts.css';
import '@gravity-ui/uikit/styles/styles.css';
```

### 2. Wrap your app in ThemeProvider

```tsx
import {ThemeProvider} from '@gravity-ui/uikit';

export default function App({children}) {
  return (
    <ThemeProvider theme="light">
      {children}
    </ThemeProvider>
  );
}
```

Available themes: `"light"`, `"dark"`, `"light-hc"`, `"dark-hc"`.

### 3. (Optional) Toaster support

If you need toast notifications, also add the `ToasterProvider`:

```tsx
import {ThemeProvider, ToasterProvider, ToasterComponent, Toaster} from '@gravity-ui/uikit';

const toaster = new Toaster();

export default function App({children}) {
  return (
    <ThemeProvider theme="light">
      <ToasterProvider toaster={toaster}>
        {children}
        <ToasterComponent />
      </ToasterProvider>
    </ThemeProvider>
  );
}
```

### 4. (Optional) SSR theme-flash prevention

For Next.js or other SSR frameworks, generate the root class name on the server:

```tsx
import {getRootClassName} from '@gravity-ui/uikit/server';

const theme = 'dark';
const rootClassName = getRootClassName({theme});
// Apply rootClassName to your <html> or root <div>
```

### 5. (Optional) Language configuration

```tsx
import {configure} from '@gravity-ui/uikit';
configure({lang: 'en'}); // 'en' (default) or 'ru'
```

## Ecosystem

Gravity UI is a family of libraries that work together:

| Package | Purpose |
|---------|---------|
| `@gravity-ui/uikit` | Core UI components |
| `@gravity-ui/icons` | 400+ SVG icons as React components |
| `@gravity-ui/date-components` | Calendar, DatePicker, RangeCalendar |
| `@gravity-ui/navigation` | App-level navigation (AsideHeader, Footer) |
| `@gravity-ui/chartkit` | Data visualization / charts |
| `@gravity-ui/dashkit` | Dashboard layouts |

## Quick Usage Example

```tsx
import {Button, TextInput, Text, Label} from '@gravity-ui/uikit';
import {Pencil} from '@gravity-ui/icons';
import {Icon} from '@gravity-ui/uikit';

function Example() {
  return (
    <div>
      <Text variant="header-1">Hello Gravity</Text>
      <TextInput placeholder="Your name" size="m" hasClear />
      <Button view="action" size="l">
        <Icon data={Pencil} size={18} />
        Edit
      </Button>
      <Label theme="success">Active</Label>
    </div>
  );
}
```

## Resources

- [Component API docs](https://gravity-ui.com/components/uikit)
- [GitHub repository](https://github.com/gravity-ui/uikit)
- [Themer (visual theme builder)](https://gravity-ui.com/themer)
- [Figma design kit](https://www.figma.com/community/file/1271150067798118027/Gravity-UI-Design-System-(Beta))
- [Telegram community](https://t.me/gravity_ui)
