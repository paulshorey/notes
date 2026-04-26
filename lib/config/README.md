# @lib/config — Shared Configuration Library

Shared build-tooling for Next.js apps in this monorepo (TypeScript, ESLint, Jest) and optional PostCSS + Tailwind + Mantine presets for apps that use that stack. New apps from `pnpm create:next-app` are scaffolded with these presets.

> **Note:** `apps/notes-next` uses **Gravity UI** and does not use the shared Tailwind, Mantine, or PostCSS CSS pipeline. It may still depend on this package for TypeScript/ESLint alignment—see `apps/notes-next/package.json`.

## Available configurations

### TypeScript (`/typescript`)

- `nextjs.json` — base TypeScript config for Next.js apps
- `base.json` — base TypeScript configuration
- `react-library.json` — TypeScript config for React libraries

### Next.js (`/next`)

- `base.config.js` — standard Next.js config (transpilePackages, reactStrictMode, image remotePatterns)

### PostCSS (`/postcss`)

- `postcss.config.cjs` — PostCSS config with Mantine presets, Tailwind CSS, and autoprefixer. Use with Mantine + Tailwind Next.js apps.

### Tailwind CSS (`/tailwind`)

- `base.config.js` — base Tailwind configuration with common theme extensions
- `app.config.js` — app preset with common content globs
- `postcss.config.js` / `shared-styles.css` — additional CSS utilities

### ESLint (`/eslint`)

- `base.js` — base ESLint configuration
- `next.js` — ESLint config for Next.js apps
- `react-internal.js` — ESLint config for internal React packages

### Jest (`/jest`)

- `next-app.js` — shared Next.js Jest factory

## Usage

### TypeScript

```json
// apps/yourapp/tsconfig.json
{
  "extends": "@lib/config/typescript/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

### Next.js

```javascript
// apps/yourapp/next.config.js
import baseNextConfig from "@lib/config/next/base";
export default baseNextConfig;
```

### PostCSS (Mantine + Tailwind apps)

```javascript
// apps/yourapp/postcss.config.cjs
module.exports = require('@lib/config/postcss');
```

### Tailwind CSS (Mantine + Tailwind apps)

```javascript
// apps/yourapp/tailwind.config.js
const appConfig = require('@lib/config/tailwind/app');
module.exports = {
  ...appConfig,
  content: [...appConfig.content, './your-paths/**/*.{js,ts,jsx,tsx,mdx}'],
};
```

### Import shared CSS styles

```css
@import '@lib/config/tailwind/shared-styles.css';
```

> When using shared CSS from this package, import `@lib/config/tailwind` (the package), not deep paths like `@lib/config/tailwind/shared-styles.css`, because Next/PostCSS resolves package CSS through the package `exports` map.
