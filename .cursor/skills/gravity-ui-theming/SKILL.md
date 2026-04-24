---
name: gravity-ui-theming
description: Use when customizing Gravity UI themes, design tokens, or component styles via CSS variables. Covers ThemeProvider, Themer tool, and CSS API conventions.
---

# Gravity UI Theming & CSS API

## ThemeProvider

Every Gravity UI app must wrap its root in `ThemeProvider`. This injects CSS variables for the active theme onto the DOM.

```tsx
import {ThemeProvider} from '@gravity-ui/uikit';

<ThemeProvider theme="light">
  <App />
</ThemeProvider>
```

### Available Themes

| Value | Description |
|-------|-------------|
| `"light"` | Default light theme |
| `"dark"` | Dark theme |
| `"light-hc"` | High-contrast light |
| `"dark-hc"` | High-contrast dark |

### ThemeProvider Props

| Prop | Type | Description |
|------|------|-------------|
| `theme` | `string` | Active theme |
| `scoped` | `boolean` | When `true`, theme classes are applied to a `<div>` inside ThemeProvider instead of `<body>`. Useful for micro-frontends or theme islands. |
| `rootClassName` | `string` | Additional CSS class on the root element |

### Nested / Scoped Themes

You can nest `ThemeProvider` to create sections with a different theme:

```tsx
<ThemeProvider theme="light">
  <main>
    Light content here
    <ThemeProvider theme="dark" scoped>
      <aside>Dark sidebar</aside>
    </ThemeProvider>
  </main>
</ThemeProvider>
```

## CSS Variables (Design Tokens)

Gravity UI uses CSS custom properties (variables) for all design tokens. When `ThemeProvider` mounts, it sets variables on the root element that control colors, typography, spacing, and more.

### Global Token Naming

Global tokens follow the pattern `--g-color-<purpose>-<weight>`:

```css
/* Text colors */
--g-color-text-primary
--g-color-text-secondary
--g-color-text-complementary
--g-color-text-hint
--g-color-text-info
--g-color-text-positive
--g-color-text-warning
--g-color-text-danger
--g-color-text-utility
--g-color-text-brand
--g-color-text-link
--g-color-text-link-hover

/* Background colors */
--g-color-base-background
--g-color-base-generic
--g-color-base-generic-hover
--g-color-base-simple-hover

/* Brand / action colors */
--g-color-base-brand
--g-color-base-brand-hover
--g-color-base-selection
--g-color-base-selection-hover

/* Semantic colors */
--g-color-base-info
--g-color-base-positive
--g-color-base-warning
--g-color-base-danger
--g-color-base-utility
```

### Component-Level CSS Variables

Each component exposes its own CSS variables following `--g-<component>-<property>`. Override them by targeting the component's class or a wrapper:

#### Button

```css
.my-custom-button {
  --g-button-text-color: #fff;
  --g-button-background-color: #1a73e8;
  --g-button-background-color-hover: #1557b0;
  --g-button-border-radius: 8px;
  --g-button-height: 44px;
  --g-button-padding: 0 20px;
  --g-button-font-size: 15px;
}
```

Full list: `--g-button-text-color`, `--g-button-text-color-hover`, `--g-button-background-color`, `--g-button-background-color-hover`, `--g-button-border-width`, `--g-button-border-color`, `--g-button-border-style`, `--g-button-focus-outline-width`, `--g-button-focus-outline-color`, `--g-button-focus-outline-style`, `--g-button-focus-outline-offset`, `--g-button-height`, `--g-button-padding`, `--g-button-border-radius`, `--g-button-font-size`, `--g-button-icon-space`, `--g-button-icon-offset`.

#### TextInput / TextArea

```css
.my-input {
  --g-text-input-text-color: #333;
  --g-text-input-background-color: #f5f5f5;
  --g-text-input-border-color: #ccc;
  --g-text-input-border-color-hover: #999;
  --g-text-input-border-color-active: #1a73e8;
  --g-text-input-border-radius: 8px;
}
```

#### Select

```css
.my-select {
  --g-select-focus-outline-color: #1a73e8;
}
```

#### Toaster

```css
.my-toasts {
  --g-toaster-width: 400px;
  --g-toaster-item-padding: 16px;
  --g-toaster-item-gap: 8px;
}
```

#### Table Actions

```css
.my-table {
  --g-table-action-popup-menu-max-height: 300px; /* default: 200px, use "none" to remove limit */
}
```

## Using the Themer Tool

Gravity UI provides a visual theme editor at https://gravity-ui.com/themer for customizing:

- **Colors**: Brand palette, semantic colors
- **Typography**: Font families and sizes
- **Border radius**: Global corner rounding

You can import/export theme configurations as JSON and apply them as CSS variable overrides.

## SCSS Mixins

UIKit ships SCSS mixins at `@gravity-ui/uikit/styles/mixins.scss`:

```scss
@use '@gravity-ui/uikit/styles/mixins.scss' as *;
```

These provide helpers for responsive breakpoints, focus outlines, and other common patterns. Check the source for the full list of available mixins.

## Strategy for Custom Themes

1. **Start with the Themer**: Use https://gravity-ui.com/themer to visually pick brand colors and export the result.
2. **Override global tokens**: Apply the exported CSS variables to your root element.
3. **Fine-tune per component**: Use component-level `--g-<component>-*` variables only where global tokens don't achieve the desired result.
4. **Avoid overriding internal class names**: They are not part of the public API and may change between versions. Always prefer CSS variable overrides.
