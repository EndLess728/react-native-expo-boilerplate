---
title: Make it yours
description: Checklist for turning a freshly generated app into your own, including bundle id, app name, icons, API URL and the example feature.
---

The CLI already set the name, slug, scheme and bundle id. Here's what's left before you ship.

## Checklist

1. **Bundle id per environment (optional).** All three environments share one bundle id by default, which keeps Firebase, push notifications and signing simple. To install development and production builds side by side, use the commented `PACKAGE_NAMES` block in `env.ts`.
2. **App name and slug.** The display name for each environment lives in `APP_NAMES` in `env.ts`, with "(Dev)" and "(Staging)" suffixes so you can tell builds apart. The `slug` and `scheme` are in `app.config.ts`.
3. **Icons and splash.** Replace `assets/icon.png` (used for the app icon, Android adaptive icon and splash screen) and `assets/favicon.png` (web).
4. **Your API.** Set `EXPO_PUBLIC_API_URL` in `.env.development`, `.env.staging` and `.env.production`. Development starts pointed at DummyJSON so the demo works.
5. **Env vars.** Add your own variables to `.env.example` and the Zod schema in `env.ts`. See [Environments](../../guides/environments/).
6. **Replace the example feature.** `src/features/posts` and the Home screen are there to show the pattern. Replace them with your own features.
7. **Real authentication.** `src/features/auth/api/authenticate.ts` is a demo. Point it at your backend, and turn on token refresh in the API client if you need it (see [API layer](../../architecture/api-layer/)).
8. **EAS project.** Run `eas init` to link the app to your Expo account, then `yarn env:push:<env>` so cloud builds get your env vars. See [EAS builds & releases](../../guides/eas/).

## Keep the guard rails

- Keep the feature folders' `index.ts` files as their public API. ESLint will stop you importing from inside another feature.
- Keep commit messages in Conventional Commits format (`feat:`, `fix:`, `chore:`…). Commitlint enforces it if you kept Husky.
- Run `yarn lint`, `yarn type-check` and `yarn test` before you push.
