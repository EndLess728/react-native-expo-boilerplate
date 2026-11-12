---
title: FAQ
description: Common questions about the React Native Expo Boilerplate and create-expo-boilerplate, including Expo Go, licensing, upgrading, choosing a stack and backends.
---

## Is it free? Can I use it for client work?

Yes. The boilerplate is MIT-licensed. Apps generated with the CLI don't include the boilerplate's license, so they're yours to license however you like, including closed-source commercial apps.

## How is this different from `create-expo-app`?

`create-expo-app` gives you a minimal starting point. This gives you a structured, production-ready app: data fetching, forms, encrypted storage, i18n, three environments, EAS workflows, tests and lint rules, all wired together and working. And you choose the navigation, state and styling libraries up front.

## Does it work in Expo Go?

No. It uses native modules (MMKV, Unistyles, Reanimated, keyboard controller) that Expo Go doesn't include. `yarn ios:development` and `yarn android:development` build a development client the first time, and after that you get the same instant reload as Expo Go.

## Should I clone the repo or use the CLI?

Use the CLI. It gives you only the stack you picked, sets your app name and bundle id, and makes a clean first commit. Clone the repo only if you want to contribute to the boilerplate itself.

## Which stack should I pick?

The defaults (Expo Router, Zustand, Unistyles, TypeScript) are the most common choice and what the template itself uses. Pick:

- **React Navigation** if your team already knows it or you need fine control over navigators.
- **Redux Toolkit** if your team uses Redux elsewhere or needs Saga for complex async flows.
- **Tailwind** if your team writes Tailwind on the web. **StyleSheet** if you want no styling dependency.
- **JavaScript** only if your team doesn't use TypeScript. You lose typed routes, typed translation keys and typed env vars.

## Does it work with my backend?

Yes. Set `EXPO_PUBLIC_API_URL`, replace the demo `authenticate()` function in `src/features/auth/api` with your login call, and adjust the pagination helpers in `src/services` if your API doesn't page with `limit` and `skip`. Firebase, Supabase or GraphQL can be added like any other library.

## How do I add push notifications or subscriptions?

From the root of a generated app, run `npx create-expo-boilerplate add notifications` or `npx create-expo-boilerplate add subscriptions`. The CLI writes the module for your app's stack, wires it in and lists what's left, like your Firebase files or RevenueCat keys. See [Adding modules](../../guides/modules/).

## Does it support the web?

The app runs on the web with `yarn web` (React Native Web is included, and Expo Router handles URLs). The focus is iOS and Android, so test web-specific layouts yourself.

## How do I upgrade the Expo SDK later?

Use Expo's upgrade guide: `npx expo install expo@latest --fix`, then `yarn prebuild:development` and test. Native folders aren't committed, so there's nothing native to merge by hand.

## Can my team use its own version?

Yes. Fork the repo, change the template, and publish the CLI under your npm scope, such as `@your-org/create-expo-boilerplate`, with restricted access. Your team then runs `npm create @your-org/expo-boilerplate`.

## Where do I report bugs or ask for features?

[Open an issue on GitHub](https://github.com/EndLess728/react-native-expo-boilerplate/issues).

## Who maintains it?

[Mantu (EndLess728)](https://github.com/EndLess728), a senior React Native and Expo developer. He also maintains [react-native-mediapipe-posedetection](https://endless728.github.io/react-native-mediapipe-posedetection/) and [expo-check-installed-apps](https://endless728.github.io/expo-check-installed-apps/).
