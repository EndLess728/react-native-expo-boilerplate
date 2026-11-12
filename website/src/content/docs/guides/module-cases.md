---
title: What the modules handle
description: Every case the notifications and subscriptions modules handle out of the box, and the parts that stay with your app or backend.
---

A checklist of the situations each [module](../modules/) already deals with, so you know what you're getting before you run `add`, and what's still yours to build. Each module's own `README.md` explains how and why.

## Notifications

`npx create-expo-boilerplate add notifications` · Firebase Cloud Messaging + NotifyKit

### Permission

| Case | What happens |
| --- | --- |
| Never asked (`undetermined`) | Banner explains why and offers **Allow**. The app never prompts on its own, only when the user taps. |
| Refused, prompt still available (`denied`, Android before the 2nd refusal) | Banner offers the prompt again |
| Refused for good (`blocked`, any iOS refusal) | Banner offers **Open Settings** instead of a button that would do nothing |
| Allowed, but Android notification channel muted (`channel-blocked`) | Detected even though every permission API reports success. Banner links to the channel settings. |
| User changes the setting in system Settings and comes back | Status re-read on app resume and on screen focus, so the banner updates |
| Granted | Banner hidden |

### Delivery

| Case | What happens |
| --- | --- |
| Push while the app is **in the foreground** | Drawn by the module (FCM draws nothing while the app is open), with heads-up on Android and a banner on iOS |
| Push while the app is **in the background** | System tray notification, heads-up when the backend sends high priority |
| Push while the app is **killed** | Delivered when the payload has a display block (`notification` / `aps.alert`) |
| Every push showing **twice** on Android | Prevented: the background handler doesn't draw on top of FCM |
| Backend sends no `channel_id` | Manifest fallback channel, so heads-up still works |
| Android channel settings need to change | Channel ids are versioned (`general.v1`), so a new version picks up the new settings |

### Tapping a notification

| Case | What happens |
| --- | --- |
| Tap while the app is in the foreground or background | Opens the route for that notification type |
| Tap on a **killed** app (cold start) | Route held until the navigator is ready, then opened |
| Tap on iOS, background or killed | Works. Firebase is set as the one owner of remote taps on iOS, so the tap isn't lost to NotifyKit. |
| Destination screen needs sign-in, user signed in | Opens normally |
| Destination screen needs sign-in, user signed out | Dropped, not queued, so it doesn't fire later when they sign in for another reason |
| The same tap arrives twice (both libraries report it) | Repeats of the same route within 2 s are ignored |
| Unknown or missing `type` in the payload | Treated as `general`: opens the app without navigating, never crashes |
| Type sent as `type` or `notification_type`, in any casing | Recognised |
| Payload contains a `route` or URL | Ignored. Routes come only from the allowlist in `config.ts`, so a bad payload can at worst open the app. |
| Payload contains an `id` | Added to the route as `?id=…` (URI-encoded), only for types listed in `TYPES_WITH_ID` |

### Token sync

| Case | What happens |
| --- | --- |
| User signs in with permission granted | Token sent to your backend (`POST <endpoint>` with `{ token, platform }`) |
| Permission granted after sign-in | Token sent at that point |
| FCM rotates the token | New token sent |
| User not signed in, or permission not granted | Nothing sent. A token before consent would look like a broken backend. |
| Registration request fails | Logged, no error toast for the user |
| Same token used by a different account after sign-out | Registered against the new user. The local token is kept on purpose. |

### Badge and local notifications

| Case | What happens |
| --- | --- |
| App opened or brought to the front | Badge cleared (`CLEAR_BADGE_ON_OPEN`, on by default) |
| Badge shows a real count (unread, pending) | `setBadgeCount(n)`, `getBadgeCount()`, `clearBadge()`. None of them ever throw. |
| A feature schedules device-side notifications | `scheduleLocalNotifications(triggers, { cancelPrefix })`: works offline; each trigger repeats weekly from its first occurrence |
| Rescheduling | Replaces only that feature's triggers (matched by prefix), never another feature's |
| Turning a feature's reminders off | Pass an empty array: everything under the prefix is cancelled |
| Android 12+ without exact-alarm permission | Uses inexact alarms that need no permission and still fire in Doze |

### Not handled: yours to build

- **What** to notify about and **when**. Recurring or scheduled pushes (reminders, digests) are sent by your backend. The module's README covers what that scheduler needs: user timezones, de-duplication, DST.
- Clearing the token on sign-out. There's no revoke call; your logout endpoint should detach it.
- In-app notification preferences (for example a "marketing" switch). Keep them separate from the device permission.
- Rich remote notifications (images, progress). Available by switching `ANDROID_DISPLAY_STRATEGY` to `app-draws`, which also needs a backend and iOS extension change.
- Remote push on the iOS simulator. It gets no token; test on a physical iPhone.

Known limits: Android local notifications can fire about a minute late (inexact alarms), pending local triggers are capped (50 on Android, about 64 on iOS), and some OEM battery savers kill local alarms.

## Subscriptions

`npx create-expo-boilerplate add subscriptions` · RevenueCat

### Subscription states

Shown by `SubscriptionStatusNotice` (drop it on Settings) and on the paywall. When several apply, the most urgent one is shown, in this order:

| Case | What the user sees | Can buy / switch? |
| --- | --- | --- |
| Two active subscriptions (billed twice) | Warning, points to support | Yes |
| Card failed, store retrying (**grace period**) | Access continues; "update your payment method" with the deadline and a link to the store | Yes |
| Google Play **account hold** (after grace)¹ | "On hold, don't buy again", link to fix payment | Yes |
| Google Play **paused** | Resume date. Doesn't read as cancelled. | Yes |
| **Family Sharing** (someone else's purchase) | Explained | No |
| **Promotional** access granted from the dashboard | Explained, with end date | No |
| Bought on the **other store**, or on the **web** (Stripe / RevenueCat Web Billing) | Names the store; the button becomes **Manage**. Purchasing is blocked in the provider, not just hidden. | No |
| Plan change made, takes effect at renewal¹ | Says the change is scheduled, so it doesn't look like it failed | Yes |
| **Lifetime** purchase | "Lifetime access", nothing to renew or manage | n/a |
| **Cancelled**, still inside the paid period | Access continues until the end date; **Resubscribe** allowed | Yes |
| **Free trial** | When the trial ends and the charge lands | Yes |
| Active | Renewal date | Yes |
| Never subscribed / expired | No notice; the paywall | Yes |

Dates include the time ("19 Sep 2026, 4:31 pm"), so sandbox subscriptions that renew every few minutes are readable too.

¹ The device can't detect these on its own. They need the optional backend record fed by RevenueCat webhooks (see the module README). Without it, an account hold looks like an ordinary expiry.

### Purchasing

| Case | What happens |
| --- | --- |
| User dismisses the store sheet | Nothing shown, not an error |
| Double tap during a purchase | Second tap ignored |
| **Payment pending** (cash / slow card on Android, Ask to Buy on iOS) | "Being processed", not an error. Access is granted automatically when it clears. |
| Network error, store outage, timeout | Retryable message naming the store |
| Purchases restricted (Screen Time, MDM, supervised account) | Final message, no retry offered |
| Product unavailable in this region, or user ineligible | Final message, no retry offered |
| This store account already owns it | Receipts re-synced silently (no sign-in prompt) and access restored |
| Receipt belongs to a different app account | Explains which account owns it |
| An error that isn't recognised | Rethrown and logged with its real code rather than shown with a guessed message |

### Plan changes

| Case | What happens |
| --- | --- |
| Android upgrade (for example monthly → yearly) | Old subscription replaced and the new plan charged now, with an explicit replacement mode Play accepts |
| Android downgrade | Takes effect at the next renewal; a toast explains the delay |
| Plan change refused because the subscription belongs to another store account | Says so, and where the change can be made, instead of reporting success |
| iOS upgrade / downgrade | Handled by the App Store within your subscription group |

### Restore, identity and the paywall

| Case | What happens |
| --- | --- |
| Restore finds a subscription | Success toast, access restored |
| Restore finds nothing | "Nothing to restore" message |
| Restore fails | Same error handling as purchases |
| User signs in | RevenueCat `logIn` with your stable user id |
| User signs out | RevenueCat `logOut`, so the next account starts anonymous instead of inheriting access |
| Another entitlement is active (second tier, typo) | Doesn't count as premium; a dev warning names it |
| Offerings fail to load | Paywall error with **Try again** |
| No API keys yet | Module off: nobody premium, paywall says plans couldn't load, nothing crashes |
| Product has no real intro offer, or user no longer eligible | No trial text shown. The paywall never advertises a trial you don't sell. |
| Any package length (weekly to lifetime) | Listed in the order RevenueCat serves them |
| Paywall feature list, highlighted plan, plan titles | Read from the offering's metadata, so you can change them without a release |
| Legal footer | Terms and privacy links under the purchase button, as both stores require |
| Non-subscriber taps a premium feature | `requirePremium(action, copy)` raises a sheet with your copy, **Try Premium** and **Maybe later** |
| Testing paid flows in development | `DEV_ALWAYS_PREMIUM` makes everyone premium in `__DEV__`. A test fails if it's committed enabled. |

### Not handled: yours to build

- Store setup the code can't fix: one Google Play subscription product with base plans, one App Store subscription group, a grace period enabled on both stores.
- Mapping your signed-in user to a RevenueCat id (`useSubscriptionUser.ts`). Until you do, purchases belong to an anonymous id per install.
- Account hold and scheduled downgrades: they need your backend record (see above).
- Syncing purchases to your backend. Use RevenueCat webhooks, which also cover renewals, cancellations and refunds while the app is closed.
- Enforcing premium where the value is used. A setting chosen while subscribed outlives the subscription, so check `isPremium` where the feature runs, not only where it's picked.
- Completing a real purchase on a simulator. It shows offerings but can't buy; use sandbox accounts.
