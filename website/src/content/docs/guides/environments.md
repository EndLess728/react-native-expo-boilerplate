---
title: Environments
description: Development, staging and production environments in the React Native Expo Boilerplate, with Zod-validated env vars, untracked env files and EAS environment sync.
---

The app has three environments. Each has its own **app name**, **env file** and **EAS environment**:

| Environment | App name | Env file | EAS environment |
| --- | --- | --- | --- |
| `development` | MyApp (Dev) | `.env.development` | `development` |
| `staging` | MyApp (Staging) | `.env.staging` | `preview` |
| `production` | MyApp | `.env.production` | `production` |

All three share one bundle id by default, which keeps Firebase, push notifications and signing set up once. To install them side by side, switch to the `PACKAGE_NAMES` block in `env.ts`.

## Env files

```bash
EXPO_PUBLIC_APP_ENV=development    # development | staging | production
EXPO_PUBLIC_API_URL=https://dummyjson.com/
```

- **Only `.env.example` is committed.** The other three are untracked and gitignored, so a real API key can't be committed by accident.
- **You never create them by hand.** `yarn install` runs `scripts/setup-env.mjs`, which creates any missing file from `.env.example`. Run `yarn env:init` to do the same on demand.
- **Existing files are never overwritten.** The script only reads them to tell you which keys they're missing.
- `.env.development` starts with the DummyJSON demo API so the app works on first run. Staging and production start with placeholders.

## How switching works

```
yarn android:staging
  → copies .env.staging to .env.local       (.env.local wins over everything else)
  → expo run:android
  → env.ts validates the values and builds a typed config
  → app.config.ts reads it for the app name, bundle id and package
  → your code imports it from @env
```

## Using env values in code

```ts
import Env from '@env';

const apiUrl = Env.EXPO_PUBLIC_API_URL;
const isProduction = Env.EXPO_PUBLIC_APP_ENV === 'production';
```

## Validation

`env.ts` checks every variable with a Zod schema:

- **In development** an invalid value logs a warning, so a typo doesn't stop you working.
- **During prebuild and builds** (`STRICT_ENV_VALIDATION=1`) it fails, so a broken config never reaches native code or a store build.

## Adding a variable

1. Add it to `.env.example`.
2. Run `yarn env:init`. It doesn't change your existing files, but it lists each one that's missing the new key.
3. Fill in the value in each `.env.<env>` file.
4. Add it to the Zod schema in `env.ts`.
5. Read it with `Env.YOUR_VAR` from `@env`, or `process.env.EXPO_PUBLIC_YOUR_VAR` (Metro needs dot notation, not `process.env[name]`).
6. Push it to EAS for cloud builds: `yarn env:push:<env>`.

:::caution
Skipping step 2 doesn't fail where you added the variable. It fails later, in a teammate's prebuild, as a Zod error about a variable they've never heard of.
:::

:::danger[EXPO_PUBLIC_ means public]
Every `EXPO_PUBLIC_*` value is bundled into the app, and anyone with the binary can read it. Put API base URLs and public keys here, never secrets.
:::

## Syncing with EAS

| Command | Does |
| --- | --- |
| `yarn env:pull:<env>` | Downloads the EAS environment's values into `.env.<env>` |
| `yarn env:push:<env>` | Uploads `.env.<env>` to its EAS environment |

On EAS builds, `scripts/eas-pre-install.sh` copies the matching `.env.<env>` to `.env.local` if it was uploaded (`.easignore` allows it even though git ignores it). If the file isn't there, for example in a CI-triggered build, the variables stored in EAS are used. Run `eas env:list` to check all three environments are filled in.

## If an env file gets tracked

`git ls-files | grep '^\.env'` should print only `.env.example`. If it shows others, untrack them without losing your values:

```bash
git rm --cached .env.development .env.staging .env.production
```
