# @lib/config — Shared Configuration Library

Shared build-tooling configurations for apps in this monorepo. Currently consumed by `apps/eighthbrain-next`.

> **Note:** `apps/notes-next` uses **Gravity UI** and does not use Tailwind, Mantine, or these shared CSS configs. It only uses the shared TypeScript and Next.js base configs.

## Available configurations

### TypeScript (`/typescript`)

- `nextjs.json` — base TypeScript config for Next.js apps
- `base.json` — base TypeScript configuration
- `react-library.json` — TypeScript config for React libraries

### Next.js (`/next`)

- `base.config.js` — standard Next.js config (transpilePackages, reactStrictMode, image remotePatterns)

### PostCSS (`/postcss`)

- `postcss.config.cjs` — PostCSS config with Mantine presets, Tailwind CSS, and autoprefixer. Used by `eighthbrain-next`.

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

> Note from `apps/eighthbrain-next/AGENTS.md`: import `@lib/config/tailwind` (the package), not deep paths like `@lib/config/tailwind/shared-styles.css`, because Next/PostCSS resolves package CSS through the package `exports` map.
