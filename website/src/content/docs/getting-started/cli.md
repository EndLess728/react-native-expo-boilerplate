---
title: CLI options
description: Every prompt and flag of create-expo-boilerplate, with examples for non-interactive and CI use.
---

```bash
npx create-expo-boilerplate@latest <project-name> [options]
```

The CLI asks about anything you don't pass as a flag. `--yes` skips the remaining questions and takes the defaults.

## Prompts and flags

| Prompt | Choices (default first) | Flag |
| --- | --- | --- |
| Project name | any folder name | first argument |
| App display name | from the folder name | `--name "My App"` |
| Bundle id / Android package | `com.<name>` | `--bundle-id com.company.app` |
| State management | Zustand · Redux Toolkit | `--state zustand\|redux` |
| Redux side effects (Redux only) | Thunk · Saga | `--redux-middleware thunk\|saga` |
| Navigation | Expo Router · React Navigation | `--navigation expo-router\|react-navigation` |
| Styling | Unistyles · StyleSheet · Tailwind (Uniwind) | `--styling unistyles\|stylesheet\|tailwind` |
| Language | TypeScript · JavaScript | `--language ts\|js` (or `--js`) |
| ESLint | yes · no | `--eslint` / `--no-eslint` |
| Husky git hooks | yes · no | `--husky` / `--no-husky` |
| Package manager | the one that ran the CLI | `--pm yarn\|npm\|pnpm\|bun` |

Other flags:

| Flag | Effect |
| --- | --- |
| `--yes` | Take the default for every option you didn't pass |
| `--no-install` | Don't install dependencies |
| `--no-git` | Don't initialise git or make the first commit |
| `--help` | Show all options |

## Examples

```bash
# All defaults, no questions
npx create-expo-boilerplate my-app --yes

# Tailwind + Redux Toolkit with sagas + React Navigation
npx create-expo-boilerplate my-app --yes \
  --styling tailwind --state redux --redux-middleware saga \
  --navigation react-navigation

# JavaScript, no Husky, custom name and bundle id
npx create-expo-boilerplate shop --yes --js --no-husky \
  --name "Corner Shop" --bundle-id com.cornershop.app
```

## Naming rules

- The **project name** becomes the npm package name and Expo slug in kebab-case: `My Cool App` becomes `my-cool-app`.
- The **display name** defaults to Title Case: `my-cool-app` becomes `My Cool App`.
- The **URL scheme** and default **bundle id** use the name without dashes: `mycoolapp` and `com.mycoolapp`.
- A bundle id must be reverse-DNS with at least two segments of letters, digits and underscores, each starting with a letter, like `com.company.app`.

## What each choice changes

| Choice | What you get |
| --- | --- |
| **Expo Router** | File-based routes in `src/app/`, typed `href`s, auth gating with `<Stack.Protected>` |
| **React Navigation** | `src/navigation/` with a root stack, auth stack and bottom tabs, typed param lists and deep-link config |
| **Zustand** | Feature stores built with `createPersistedStore()`, persisted to encrypted MMKV |
| **Redux Toolkit** | A configured store with redux-persist on MMKV, typed hooks, and an auth slice using Thunk or Saga, with tests |
| **Unistyles** | `StyleSheet.create((theme, rt) => …)` from `react-native-unistyles`, breakpoints, theme switching |
| **StyleSheet** | Plain React Native `StyleSheet`, plus `makeStyles((theme) => …)` for theme-aware styles |
| **Tailwind** | `className` with Uniwind (Tailwind v4), theme tokens in `global.css` |
| **JavaScript** | The TypeScript template compiled to JavaScript, then formatted with Prettier |
| **No ESLint / No Husky** | Removes the config, the dependencies and lint-staged / Commitlint |

Every combination has the same screens, the same light and dark theme tokens, and the same feature-based layout. See [Styling & theming](../../architecture/styling/) and [State management](../../architecture/state/).

## Keeping it private to a team

You can publish your own fork of the CLI under an npm scope with restricted access, for example `@your-org/create-expo-boilerplate`, and run it with `npm create @your-org/expo-boilerplate`. Details are in the [CLI README](https://github.com/EndLess728/react-native-expo-boilerplate/tree/main/cli#publishing).
