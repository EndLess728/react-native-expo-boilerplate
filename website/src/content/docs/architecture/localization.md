---
title: Localization (i18n)
description: Typed translations with i18next in the React Native Expo Boilerplate, including English, Spanish and Arabic with right-to-left layout, a saved language and adding new languages.
---

The app ships with **English, Spanish and Arabic**, using i18next and react-i18next. Translation keys are typed, the user's choice is saved in encrypted storage, and switching to or from Arabic flips the layout to right-to-left.

## Files

| File | Purpose |
| --- | --- |
| `src/localization/translations/en.json` | English strings, and the source of the typed keys |
| `src/localization/translations/es.json`, `ar.json` | Spanish and Arabic |
| `src/localization/resources.ts` | Registers each language |
| `src/localization/i18n.ts` | `initI18n()`: picks the saved language, else the device language, else English |
| `src/localization/utils.tsx` | `useTranslate()`, `translate()`, `useSelectedLanguage()`, `changeLanguage()` |

## Using translations

In components, use the hook so text updates when the language changes:

```tsx
import { useTranslate } from '@/localization/utils';

const t = useTranslate();
<Text>{t('settings.title')}</Text>;
<Text>{t('home.loaded_count', { loaded: 20, total: 150 })}</Text>; // "20 of 150 loaded"
```

Outside React (toasts, alerts, API error messages), use `translate()`:

```ts
import { translate } from '@/localization/utils';
showSuccessToast({ title: translate('auth.login_success') });
```

Keys are typed from `en.json`, so `t('settings.titel')` is a type error and your editor autocompletes every key.

## Adding a string

1. Add the key to `en.json`, then the same key to `es.json` and `ar.json`.
2. Use it with `t('your.key')`.

Group keys by feature (`auth.*`, `settings.*`, `validation.*`) so files stay easy to scan.

## Switching language

```tsx
import { useSelectedLanguage } from '@/localization/utils';

const { language, setLanguage } = useSelectedLanguage();
setLanguage('es');
```

The choice is saved to MMKV and restored on the next launch. Before the user picks one, the app follows the device language, and falls back to English for languages it doesn't have.

## Right-to-left

Arabic is right-to-left. When a language change crosses between left-to-right and right-to-left, the app sets React Native's RTL flag and restarts itself (a reload in development), because native layout direction only applies after a restart. Switching between two left-to-right languages happens instantly.

Use `start` and `end` instead of `left` and `right` in styles (`paddingStart`, `marginEnd`…) so layouts mirror correctly.

## Adding a language

1. Create `src/localization/translations/fr.json` with every key from `en.json`.
2. Register it in `resources.ts`:

   ```ts
   import fr from '@/localization/translations/fr.json';

   export const resources = {
     en: { translation: en },
     es: { translation: es },
     ar: { translation: ar },
     fr: { translation: fr },
   };
   ```

3. Add it to the `LANGUAGES` list in `SettingsScreen.tsx`, for example `{ code: 'fr', label: 'Français' }`.
4. For another right-to-left language, update the RTL check in `changeLanguage()` in `utils.tsx`, which currently only treats `ar` as right-to-left.

:::tip
The project's `.skills/localization.md` walks an AI assistant through these steps. See [Working with AI assistants](../../guides/ai-assistants/).
:::
