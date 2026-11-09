---
title: Scripts
description: Every package.json script in the React Native Expo Boilerplate, for running, building, repacking, EAS, env files and code quality.
---

`<env>` is `development`, `staging` or `production`. Examples use `yarn`. Generated apps use the package manager you picked.

## Develop

| Script | Does |
| --- | --- |
| `yarn start` | Start Metro for the development client |
| `yarn start:<env>` | Start Metro with that environment's env file |
| `yarn ios:<env>` | Build and run on iOS |
| `yarn android:<env>` | Build and run on Android |
| `yarn web` | Start the web version |

## Native projects and local builds

| Script | Does |
| --- | --- |
| `yarn prebuild:<env>` | Regenerate `android/` and `ios/` (clean, strict env validation) |
| `yarn build:android:<env>` | Prebuild, then a Gradle release build (APK) |
| `yarn build:ios:<env>` | Prebuild, then open Xcode to archive |
| `yarn repack:android:<env>` | Swap new JS into the last Android build, or full build if native changed |
| `yarn repack:ios:<env>` | Same for iOS (seed the cache with `--source-app` first) |

Repack flags: `--install`, `--force-build`, `--no-build`, `--js-bundle-only`, `--source-app <path>`, and `--ks`, `--ks-pass`, `--ks-key-alias`, `--ks-key-pass` for custom signing. See [Local builds & repack](../../guides/local-builds/).

## EAS

| Script | Does |
| --- | --- |
| `yarn eas:build:android:<env>` · `yarn eas:build:ios:<env>` | EAS cloud build for one platform |
| `yarn eas:workflow:build` | Build workflow, both platforms in parallel (`-F profile=… -F platform=…`) |
| `yarn eas:workflow:build:<env>` | Build workflow for one profile |
| `yarn eas:workflow:build:fast` | Reuse and repack a matching build, compile only if needed |
| `yarn eas:workflow:release` | Approval, production build, store submission |
| `yarn eas:workflow:validate` | Validate all three workflow files |
| `yarn ios-build-production-auto-submit` | One-off production iOS build and submit, without the approval step |
| `yarn android-build-production-auto-submit` | Same for Android |

## Env files

| Script | Does |
| --- | --- |
| `yarn env:init` | Create missing `.env.*` files from `.env.example` and list missing keys. Never overwrites |
| `yarn env:pull:<env>` | Download values from the EAS environment |
| `yarn env:push:<env>` | Upload values to the EAS environment |

## Code quality

| Script | Does |
| --- | --- |
| `yarn lint` / `yarn lint:fix` | ESLint, with or without fixes |
| `yarn type-check` | TypeScript check |
| `yarn test` / `yarn test:watch` / `yarn test:coverage` | Jest |

## Automatic

| Script | When |
| --- | --- |
| `postinstall` | After every install: applies `patch-package` patches and creates missing env files |
| `prepare` | Installs Husky git hooks |
| `eas-build-pre-install` | On EAS builders: copies the right env file into place |
