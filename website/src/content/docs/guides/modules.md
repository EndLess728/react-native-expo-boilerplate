---
title: Adding modules
description: Add push notifications (Firebase Cloud Messaging) or in-app subscriptions (RevenueCat) to an existing app with create-expo-boilerplate add.
---

Bigger features ship as **modules** you add to a generated app when you need them, instead of up front. The CLI writes the variant that matches your app's stack, wires it in, and tells you what's left.

```bash
cd my-app
npx create-expo-boilerplate add notifications
npx create-expo-boilerplate add subscriptions
```

## Available modules

| Module | Adds | Built on |
| --- | --- | --- |
| `notifications` | Push and local notifications in `src/notifications/` | Firebase Cloud Messaging, NotifyKit |
| `subscriptions` | In-app subscriptions, a paywall and a premium gate in `src/subscription/` | RevenueCat |

Each module brings its own `README.md` with setup, store configuration, gotchas and troubleshooting.

## How `add` works

- **It knows your stack.** Every generated app records its choices in `boilerplate.json` (navigation, state, styling, language). Apps created before that file existed are detected from their files.
- **It writes the matching variant.** Expo Router or React Navigation, Unistyles / StyleSheet / Tailwind, TypeScript or JavaScript — the same module, in your app's idiom.
- **It wires it in.** Entry file, `AppProviders`, `app.config.ts`, route registration, `env.ts`, translations (English, Spanish, Arabic) and Jest mocks.
- **It's safe to run.** It refuses to run on uncommitted changes (`--force` overrides), so the module lands as one diff you can review. Everything is built in a staging copy and only written back if every step succeeds. `--dry-run` lists the changes without writing anything.
- **It doesn't guess.** If you've customised a file it needs to patch beyond recognition, it applies everything else and prints the one edit to make by hand.
- **Modules combine.** Add them in any order; running the same one twice is refused.

Common flags:

| Flag | Effect |
| --- | --- |
| `--dry-run` | Show what would change, write nothing |
| `--yes` | Take defaults instead of prompting |
| `--force` | Run even with uncommitted changes |
| `--no-install` | Don't install the new dependencies |

## Notifications

```bash
npx create-expo-boilerplate add notifications
```

Prompts for your backend's token endpoint (default `devices/push-token`), whether to show the permission banner on Settings, and — optionally — the paths to `google-services.json` and `GoogleService-Info.plist`.

You get:

- **Permission handling** that never prompts on its own: a banner explains each of five states (including "blocked" and "Android channel muted", which the OS reports as success) and offers the one action that fixes it.
- **Delivery in every app state** — foreground, background and killed — with Android channels and heads-up configured, and the Android duplicate-notification trap closed.
- **Tap routing** from an allowlist in `config.ts` (never a URL from the payload), including cold start, with signed-in-only routes gated and duplicate taps ignored.
- **Token sync** to your backend once the user is signed in and has granted permission.
- **App icon badge** cleared on open, or kept in sync with your own count.
- **Local scheduling** for features that need the device to fire a notification.

What's left for you:

1. Add the Firebase config files to `firebase/` (if you skipped the prompt) — **native builds fail without them**.
2. Upload your APNs key (`.p8`) in Firebase → Project settings → Cloud Messaging.
3. Make your backend accept the token (`POST <endpoint>` with `{ token, platform }`), or edit `src/notifications/useNotificationSync.ts`.
4. Rebuild the dev client: `npx expo prebuild --clean`, then `yarn ios:development` / `yarn android:development`.
5. Test remote push on a physical iPhone — the iOS simulator gets no push token.

## Subscriptions

```bash
npx create-expo-boilerplate add subscriptions
```

Prompts for the RevenueCat entitlement id (default `premium`) and, optionally, your public SDK keys (`appl_…`, `goog_…`).

You get:

- **`useSubscription()`** — `isPremium`, `purchase`, `restore`, the derived subscription state.
- **`requirePremium(action, copy)`** — runs `action` for a subscriber; otherwise raises a bottom sheet with your copy and a button to the paywall.
- **A paywall** built from your current RevenueCat offering: every package, a feature list and highlighted plan from the offering's metadata (changeable without an app release), restore, and the legal footer both stores require.
- **Every store state handled** — grace period, Play account hold, trial, pause, cancelled-but-active (resubscribe allowed), family sharing, promotional, lifetime, bought on another store or the web, Android plan changes, pending payments, receipts linked to another account.
- **No crash without keys** — until you add them, nobody is premium and the paywall says plans couldn't load.

Gate a feature:

```tsx
const { requirePremium } = useSubscription();

<Button title="Export" onPress={() => requirePremium(startExport, { title: 'Unlock exports' })} />;
```

What's left for you:

1. Add your RevenueCat public SDK keys to `.env.development` / `.staging` / `.production` (if you skipped the prompt).
2. Map your signed-in user to a RevenueCat id in `src/subscription/useSubscriptionUser.ts` — use your backend's stable user id, never an email. Until then purchases belong to an anonymous id per install.
3. Set `TERMS_OF_USE_URL` and `PRIVACY_POLICY_URL` in `src/subscription/config.ts` — both stores reject a paywall without them.
4. In RevenueCat, create the entitlement, attach your products and mark an offering as current.
5. Rebuild the dev client — `react-native-purchases` is a native module.
6. Test with sandbox accounts (StoreKit sandbox / a Play license tester); the simulator can show offerings but not complete a purchase.

The module's README covers the store setup that matters: one Play subscription product with base plans, one App Store subscription group, explicit proration on Android plan changes, and the optional backend record that unlocks the account-hold and scheduled-plan-change banners.
