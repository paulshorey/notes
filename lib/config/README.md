# @lib/config — Shared Configuration Library

Shared TypeScript and ESLint presets for the packages in this monorepo.

## Available configurations

### TypeScript (`/typescript`)

- `base.json` — strict base configuration (`lib/db-items` extends it)
- `nextjs.json` — Next.js app configuration built on `base.json`
  (`apps/notes-next` extends it)

### ESLint (`/eslint`)

- `base.js` — base flat config: recommended JavaScript and TypeScript rules,
  Prettier compatibility, and Turborepo environment-variable checks
- `next.js` — exported as `@lib/config/eslint/next-js`; adds React, React Hooks,
  and Next.js rules to the base config (`apps/notes-next` uses it)

## Usage

### TypeScript

```json
// apps/yourapp/tsconfig.json
{
  "extends": "@lib/config/typescript/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

### ESLint

```javascript
// apps/yourapp/eslint.config.js
import { nextJsConfig } from "@lib/config/eslint/next-js";

export default nextJsConfig;
```
