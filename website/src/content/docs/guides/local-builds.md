---
title: Local builds & repack
description: Run, prebuild and build release versions of the app locally, and use repack to turn JS-only release rebuilds from minutes into seconds.
---

`<env>` is always `development`, `staging` or `production`.

## Run on a simulator or device

```bash
yarn ios:<env>          # build and run on iOS
yarn android:<env>      # build and run on Android
yarn start:<env>        # just start Metro for an installed dev build
```

These copy the right env file, generate the native projects if needed, compile and launch. After the first run, JavaScript changes reload instantly through Metro.

## Regenerate native projects

```bash
yarn prebuild:<env>
```

Runs `expo prebuild --clean` with strict env validation. Do this after changing `app.config.ts`, adding a config plugin or adding a native dependency.

## Local release builds

```bash
yarn build:android:<env>    # prebuild, then a Gradle release build → APK
yarn build:ios:<env>        # prebuild, then opens Xcode to archive
```

Local Android release builds are signed with the debug keystore on purpose. Store builds go through EAS, which holds your real signing keys. See [EAS builds & releases](../eas/).

## Repack: release builds in seconds

A full release build re-runs prebuild and Gradle every time, which takes minutes even if you only changed a TypeScript file. **Repack** takes the APK or app from your last real build and swaps in a freshly bundled JavaScript payload instead.

```bash
yarn repack:android:staging                    # repack, or do a full build if native code changed
yarn repack:android:staging --install          # …and install it on the connected device
yarn repack:android:staging --force-build      # ignore the cache and rebuild native
yarn repack:android:staging --no-build         # fail instead of falling back to a full build
yarn repack:android:staging --js-bundle-only   # keep the binary's app metadata

yarn repack:ios:staging --source-app path/to/App.app   # seed the cache from an Xcode build
yarn repack:ios:staging                                # repack from the cached build
```

### When to use it

| Use repack | Do a full build |
| --- | --- |
| Only JS/TS changed: screens, hooks, styles, translations, logic | You added or removed a native dependency |
| Sending a fresh staging build to QA | You changed a config plugin or native settings in `app.config.ts` |
| Testing release-mode behaviour | You upgraded Expo or React Native |
| Trying the same build with a different env value | You're making a store release |

Repack isn't for day-to-day development. Metro and Fast Refresh already cover that.

### It won't produce a broken build

Repacked JavaScript only works if the native side hasn't changed. The script fingerprints the project with `@expo/fingerprint`, stores the hash with the cached build in `.repack/`, and compares it before every repack. If native code changed, it does a full build instead (or exits with an error if you passed `--no-build`).

So the **first run is slow** because it seeds the cache. Every run after that is fast, until something native changes.

### iOS needs one manual step

`yarn build:ios:*` opens Xcode rather than producing a file at a known path. Build or archive in Xcode once, seed the cache with `--source-app` (a simulator `.app` or a device `.ipa`), and later repacks are fast.

### Android signing

Repack re-signs the APK. Signing with a different key than the installed app makes the install fail with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. The default is the debug keystore, which matches local release builds. When repacking a build that EAS made, pass `--ks`, `--ks-pass`, `--ks-key-alias` and `--ks-key-pass`.
