# React Dev Environments

{% embed url="https://dev.to/jam3/managing-env-variables-for-provisional-builds-h37" caption="" %}

## Environment variables:

Make two files: `.env.development` and `.env.production`

In each file, define variables. Each variable must be prepended with `REACT_APP_` ...

```text
REACT_APP_DOC_TITLE = "Development environment"
REACT_APP_IDK_WHAT = "Idk what"
```

In the React app, check if you're in development \(npm start\) or production \(npm run build\) with:  
`process.env.NODE_ENV`  
Check for whatever custom variables you set with: `process.env.REACT_APP_DOC_TITLE`

## Staging environment:

Can't define 3 different .env files \(dev/staging/production\), but here's a workaround:

`.env.production.local`

Copy into it, whatever variables you want to use, from `.env.development`.  
**Before compiling for production \(`npm run build`\), comment out the contents of this file, or remove the file, so it does not get used in production!**

This lets me use production-compiled code, but with a local database, which I need for my particular version of "staging".

**Ofcourse, doing this manually is error-prone!!!  
So, here is a way to automate it, in package.json:**

```text
"start": "react-scripts start",
"build:production": "echo \"\" > .env.production.local && react-scripts build; cp -R build /www/ps/www/new;",
"build:staging": "echo \"REACT_APP_API_HOST = \\\"$(ipconfig getifaddr en0)\\\"\" > .env.production.local && react-scripts build;",
```

line:1 will be development environment, will use `.env.development` variables  
line:2 will be  production, will use `.env.production` variables  
**line:3 is the compromise!** Will use `.env.production` variables, but will overwrite them with `.env.production.local`

In this case, `.env.production.local` is temporary, meant to be written to only by the `npm build` script. **So add it to `.gitignore`!!!**

## What **the heck** is "staging"?

It's to test production code, before you publish. In companies I've worked, it was "production" code, but tied to a "development" database. This has worked well.

