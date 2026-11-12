# React Native Expo Boilerplate

📖 **[Documentation](https://endless728.github.io/react-native-expo-boilerplate/)** · 📦 [`create-expo-boilerplate` on npm](https://www.npmjs.com/package/create-expo-boilerplate)

Production-ready React Native starter on **Expo SDK 58**, **React Native 0.88** and **React 19.3**. It includes file-based routing, three app environments, type-checked env config, encrypted storage, i18n and a feature-based folder layout, so you can skip setup and start on features.

| Area | Library |
|---|---|
| Framework | [Expo](https://expo.dev/) SDK 58 + React Compiler |
| Navigation | [Expo Router](https://docs.expo.dev/router/introduction/) (typed routes) on React Navigation v7 (stack, tabs, drawer), or plain React Navigation via the CLI |
| State | [Zustand](https://github.com/pmndrs/zustand) persisted to MMKV, or Redux Toolkit via the CLI |
| Data fetching | [TanStack Query v5](https://tanstack.com/query) + [Axios](https://axios-http.com/) + [react-query-kit](https://github.com/nichenqin/react-query-kit) |
| Forms | [React Hook Form](https://react-hook-form.com/) + [Zod v4](https://zod.dev/) |
| Styling | [Unistyles 3](https://unistyl.es/), or `StyleSheet` / Tailwind ([Uniwind](https://uniwind.dev/)) via the CLI; light and dark themes |
| Storage | [MMKV](https://github.com/mrousavy/react-native-mmkv) (AES-encrypted) + [expo-secure-store](https://docs.expo.dev/versions/latest/sdk/securestore/) for the key |
| i18n | [i18next](https://www.i18next.com/) + react-i18next (English, Spanish, Arabic with RTL) |
| Testing & quality | jest-expo + React Native Testing Library, ESLint 9, Prettier, Husky, Commitlint |

## Create a New App

Don't clone this repo for a new project. Generate one with the CLI: it asks which stack you want, writes an app with only that stack, installs dependencies and makes the first git commit.

**Requirements:** Node.js 22.13+ or 24.3+, Xcode 26.4+ (iOS) and/or Android Studio (Android).

```bash
npx create-expo-boilerplate@latest my-app
# or: yarn create expo-boilerplate my-app · pnpm create expo-boilerplate my-app · bun create expo-boilerplate my-app
```

Press Enter at each prompt to take the default, or pass flags to skip it:

| Prompt | Choices (default first) | Flag |
|---|---|---|
| Project name | any folder name | first argument |
| App display name | from the folder name | `--name "My App"` |
| Bundle id / Android package | `com.<name>` | `--bundle-id com.company.app` |
| State management | Zustand · Redux Toolkit | `--state zustand\|redux` |
| Redux side effects | Thunk · Saga | `--redux-middleware thunk\|saga` |
| Navigation | Expo Router · React Navigation | `--navigation expo-router\|react-navigation` |
| Styling | Unistyles · StyleSheet · Tailwind | `--styling unistyles\|stylesheet\|tailwind` |
| Language | TypeScript · JavaScript | `--language ts\|js` (or `--js`) |
| ESLint / Husky | yes · no | `--eslint` `--no-eslint` / `--husky` `--no-husky` |
| Package manager | the one you ran the CLI with | `--pm yarn\|npm\|pnpm\|bun` |

`--yes` takes the default for everything you didn't pass. Other flags: `--no-install`, `--no-git`, `--help`.

```bash
# Tailwind + Redux Toolkit with sagas + React Navigation, no prompts
npx create-expo-boilerplate my-app --yes --styling tailwind --state redux --redux-middleware saga --navigation react-navigation

# Then run it (the first run generates the native projects, so it takes a few minutes)
cd my-app
yarn ios:development        # or yarn android:development
```

The generated app comes with its own README for the stack you picked. The CLI source, how to test every combination, and how publishing works are in [`cli/`](./cli/README.md).

### Add Modules Later

Bigger features ship as modules you add to a generated app when you need them. From the app's root:

```bash
npx create-expo-boilerplate add notifications   # push + local notifications
npx create-expo-boilerplate add subscriptions   # in-app subscriptions
```

| Module | What you get |
|---|---|
| `notifications` | Firebase Cloud Messaging + NotifyKit: permission handling with a five-state banner, Android channels, delivery in foreground / background / killed states, allowlisted tap routing (cold start included), token sync to your backend, app icon badge, local scheduling |
| `subscriptions` | RevenueCat: `useSubscription()` and `requirePremium()`, a premium gate sheet, a paywall built from your current offering, and every store state — grace period, account hold, trial, pause, cancelled, family sharing, lifetime, cross-store, plan changes, pending payments |

`add` writes the variant that matches the app's stack (navigation, styling, language), wires it in, merges its translations and test mocks, and prints what's left (Firebase files, API keys, your user id). It refuses to run on uncommitted changes, builds everything in a staging copy first, and `--dry-run` lists the changes without writing. Each module brings its own README with setup, store configuration and troubleshooting. Details: [docs → Adding modules](https://endless728.github.io/react-native-expo-boilerplate/guides/modules/).

## Work on This Repo

The repo is itself the template (Expo Router + Zustand + Unistyles + TypeScript). The CLI picks up any change you make here.

**Prerequisites:** Node.js 22.13+ or 24.3+, Yarn v1, Xcode 26.4+ / Android Studio, and `npm i -g eas-cli` for cloud builds.

```bash
git clone https://github.com/EndLess728/react-native-expo-boilerplate.git
cd react-native-expo-boilerplate
yarn install                # also creates .env.development / .staging / .production
yarn ios:development        # or yarn android:development — prebuild + run
```

`android/` and `ios/` are not in git. `expo prebuild` generates them from `app.config.ts`, with the right name and bundle id for each environment.

## Commands

| Task | Command |
|---|---|
| Start Metro | `yarn start` · `yarn start:<env>` |
| Build and run on a device or simulator | `yarn ios:<env>` · `yarn android:<env>` |
| Regenerate native projects | `yarn prebuild:<env>` |
| Local release build | `yarn build:android:<env>` (APK) · `yarn build:ios:<env>` (opens Xcode) |
| Fast rebuild after JS-only changes | `yarn repack:android:<env>` · `yarn repack:ios:<env>` |
| EAS cloud build | `eas build --profile <env> --platform android\|ios\|all` |
| EAS workflows | `yarn eas:workflow:build` · `yarn eas:workflow:build:fast` · `yarn eas:workflow:release` |
| Env files | `yarn env:init` · `yarn env:pull:<env>` · `yarn env:push:<env>` |
| Quality | `yarn lint` · `yarn lint:fix` · `yarn type-check` · `yarn test` · `yarn test:coverage` |

`<env>` is `development`, `staging` or `production`. Every flag, the repack rules and the EAS profiles are in [docs/builds.md](docs/builds.md).

## Environments

- Each environment has its own app name and env file. `yarn <platform>:<env>` copies `.env.<env>` to `.env.local` before it starts.
- Only `.env.example` is committed. `yarn install` creates the other three from it, and **never overwrites a file that already exists**.
- `.env.development` starts with `EXPO_PUBLIC_API_URL=https://dummyjson.com/`, a free demo API, so the app shows real data on first run. Staging and production start with placeholders.
- `env.ts` checks every variable with Zod: it warns in development and fails the build during prebuild.
- **Adding a variable:** add it to `.env.example`, run `yarn env:init` (it lists the files missing the key), add it to the schema in `env.ts`, then `yarn env:push:<env>` for EAS builds.

```bash
EXPO_PUBLIC_APP_ENV=development    # development | staging | production
EXPO_PUBLIC_API_URL=https://dummyjson.com/
```

More detail, including how values reach EAS builds, in [docs/environments.md](docs/environments.md).

## Project Structure

```
src/
├── app/            # Expo Router routes: one-line re-exports of feature screens
│   ├── (auth)/     #   login
│   └── (tabs)/     #   index → Home, settings → Settings
├── features/       # One folder per feature: screens/, store/, api/, index.ts (its public API)
│   ├── auth/       #   login, session, user store
│   ├── home/       #   posts demo screen
│   ├── posts/      #   api/ — example API hooks
│   └── settings/   #   language picker, logout
├── services/       # Axios client, QueryClient, pagination helpers
├── shared/         # Components, hooks, constants, utils used across features
├── store/          # Persisted-store helper + rehydrateStores()
├── storage/        # Encrypted MMKV + token storage
├── localization/   # i18n setup, en/es/ar translations, typed hooks
└── styles/, theme/ # Themes, fonts, text styles
```

Other code imports a feature only through its `index.ts` (`@/features/auth`); ESLint rejects deep imports. Aliases: `@/*` → `src/*`, `@env` → `env.ts`. The full tree and the reasons behind it are in [docs/architecture.md](docs/architecture.md).

## API Example

The Home screen calls [DummyJSON](https://dummyjson.com/docs) with the hooks in [`src/features/posts/api`](src/features/posts/api):

| Hook | Request | Shows |
|---|---|---|
| `useInfinitePosts()` | `GET posts?limit=10&skip=…` | Paginated list that loads more on scroll |
| `usePost({ variables: { id } })` | `GET posts/:id` | Query that only runs once a post is tapped |
| `useAddPost()` | `POST posts/add` | Mutation |
| `usePosts()` | `GET posts` | The simplest list query |

Every hook uses the shared `client` from `@/services`. That client adds the auth token, checks the connection, handles 401s and shows error toasts, so screens only render the state. To add an endpoint, create `src/features/<feature>/api/use-<action>.ts`:

```ts
import { createQuery } from 'react-query-kit';
import { client } from '@/services';

export const useTodos = createQuery({
  queryKey: ['todos'],
  fetcher: (_, { signal }) => client.get('todos', { signal }).then((r) => r.data),
});
```

VS Code snippets scaffold the common hooks (`useiq` for an infinite query). For your own backend, point `EXPO_PUBLIC_API_URL` at it and replace the `posts` feature.

## Adding Things

- **Screen:** create it in `src/features/<feature>/screens/`, export it from the feature's `index.ts`, and add a one-line route file such as `src/app/about.tsx` → `/about`. For a tab, put the route in `src/app/(tabs)/` and register it in `(tabs)/_layout.tsx`, `TabBarIcon.tsx` and `TabBarLabel.tsx`.
- **Navigation:** `<Link href="/settings">` or `useRouter().push('/settings')`. Auth gating is automatic: `useLogin()` / `useLogout()` switch between the `(auth)` and `(tabs)` groups.
- **Store:** create it with `createPersistedStore(...)` and add it to `rehydrateStores()` in `src/store/index.ts`, or it won't load its saved state.
- **Translation:** add the key to `en.json`, `es.json` and `ar.json`, then use `useTranslate()` in components.
- **Push notifications / subscriptions:** `npx create-expo-boilerplate add notifications` or `add subscriptions` in a generated app — see [Add Modules Later](#add-modules-later).

Worked examples for each are in [docs/architecture.md](docs/architecture.md). [`.skills/`](.skills) has step-by-step guides for AI coding assistants: `api-hook-creation.md`, `ui-creation.md`, `localization.md`.

## Releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org/); Commitlint enforces this on every commit. Each push to `main`:

1. Publishes a **GitHub Release** with a changelog. The version comes from the commits: `feat` → minor, `fix` → patch, `!` → major.
2. Publishes the **CLI to npm** with the same version. This needs the `NPM_TOKEN` repository secret.

Pushes with only `chore` / `docs` / `ci` commits release nothing. Store releases go through `yarn eas:workflow:release`. See [docs/builds.md](docs/builds.md#releases).

## Make It Yours

1. Set your bundle id in `env.ts` (replace `com.expo.template`). All three environments share it by default; to install dev and production side by side, use the commented `PACKAGE_NAMES` block in `env.ts`.
2. Set the app name and `slug` in `app.config.ts` (replace `ExpoTemplate`).
3. Replace `assets/icon.png` and `assets/favicon.png`.
4. Put your API URLs in `.env.*` and your variables in the `env.ts` schema.
5. Replace the `posts` example with your own features.

## License

[MIT](LICENSE) © [EndLess728](https://github.com/EndLess728). Use it in personal and commercial projects. Apps generated with the CLI don't include this license: they're yours to license however you like.
