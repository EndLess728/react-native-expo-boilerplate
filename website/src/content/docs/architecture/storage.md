---
title: Storage & security
description: AES-encrypted MMKV storage with a key kept in the iOS Keychain or Android Keystore, token storage and how persisted state is protected in the React Native Expo Boilerplate.
---

All persistent data (stores, the saved language, auth tokens) goes into **MMKV**, a fast key-value store, **encrypted with AES**. The encryption key is never hard-coded.

## How the key is managed

```
First launch:   expo-crypto → random 32-byte key → expo-secure-store (Keychain / Keystore)
Later launches: expo-secure-store → key → open encrypted MMKV
```

- **iOS:** the key is stored in the Keychain.
- **Android:** the key is stored with expo-secure-store, which is backed by the Android Keystore.

`initStorage()` in `src/storage/index.ts` does this at start-up, before anything reads from storage. Because getting the key is asynchronous, stores are created with hydration turned off and loaded afterwards by `rehydrateStores()`. See [Project structure → Start-up order](../project-structure/#start-up-order).

## Reading and writing

```ts
import { getItem, setItem, removeItem, storage } from '@/storage';

setItem('onboarding-done', true);
const done = getItem<boolean>('onboarding-done');
removeItem('onboarding-done');
```

`getItem` and `setItem` serialise values as JSON. For reactive values in components, use MMKV's hooks with the shared `storage` instance, for example `useMMKVString('key', storage)`.

## Tokens

`src/storage/token.ts` keeps auth tokens apart from app state:

| Function | Use |
| --- | --- |
| `setTokens(access, refresh)` | Save both after login |
| `getAccessToken()` / `getRefreshToken()` | Read them (the API client does this for you) |
| `clearTokens()` | Remove both on logout |

## What's never stored

- **Raw passwords.** The auth state keeps only the user profile returned by your API.
- **Secrets in the bundle.** Anything in `EXPO_PUBLIC_*` env vars ships inside the app and can be read by anyone with the binary. Keep real secrets on your server.
