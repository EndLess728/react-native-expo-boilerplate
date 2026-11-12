# create-expo-boilerplate

Scaffold a new Expo app from [react-native-expo-boilerplate](https://github.com/EndLess728/react-native-expo-boilerplate) ([docs](https://endless728.github.io/react-native-expo-boilerplate/)) — no cloning, no deleting example code by hand.

```bash
npx create-expo-boilerplate my-app
# or
yarn create expo-boilerplate my-app
pnpm create expo-boilerplate my-app
bun create expo-boilerplate my-app
```

It asks a few questions, writes the project, installs dependencies, sets up git (and Husky), and makes the first commit.

## Options

| Prompt | Choices | Default | Flag |
|---|---|---|---|
| State management | Zustand · Redux Toolkit | Zustand | `--state zustand\|redux` |
| Redux side effects (Redux only) | Thunk · Saga | Thunk | `--redux-middleware thunk\|saga` |
| Navigation | Expo Router · React Navigation | Expo Router | `--navigation expo-router\|react-navigation` |
| Styling | Unistyles · StyleSheet · Tailwind (Uniwind) | Unistyles | `--styling unistyles\|stylesheet\|tailwind` |
| Language | TypeScript · JavaScript | TypeScript | `--language ts\|js` (or `--js`) |
| ESLint | yes · no | yes | `--eslint` / `--no-eslint` |
| Husky git hooks | yes · no | yes | `--husky` / `--no-husky` |
| App display name | — | from the folder name | `--name "My App"` |
| Bundle id / Android package | — | `com.<name>` | `--bundle-id com.company.app` |
| Package manager | yarn · npm · pnpm · bun | whatever ran the CLI | `--pm` |

Other flags: `--yes` (take defaults for anything not passed), `--no-install`, `--no-git`.

```bash
# Fully non-interactive
npx create-expo-boilerplate my-app --yes \
  --state redux --redux-middleware saga \
  --navigation react-navigation --styling tailwind --js --no-husky
```

### Styling

| Option | Styles are written with | Extra packages |
|---|---|---|
| Unistyles (default) | `StyleSheet.create((theme, rt) => …)` from `react-native-unistyles` | `react-native-unistyles` |
| StyleSheet | React Native's `StyleSheet`; `makeStyles((theme) => …)` from `@/theme` for theme-aware styles | none |
| Tailwind | `className` via [Uniwind](https://uniwind.dev/) (Tailwind v4); theme colors, fonts and text roles in `global.css`, plus `metro.config.js` | `uniwind`, `tailwindcss` |

Every option has the same screens and the same light/dark theme tokens (`src/styles/themes.ts`), and exposes `useAppTheme()` from `@/theme` for colors that must be passed as props (icon colors, tab bar tints, `placeholderTextColor`). The project's `.skills/ui-creation.md` and the `rnfu` VS Code snippet are rewritten for the option you pick.

Every combination uses the same feature-based layout (`src/features/<feature>`, `src/shared`, …). Screens only talk to state through the auth feature's hooks (`useIsLoggedIn`, `useLogin`, …), which is why switching the state library or the navigator doesn't touch a single screen.

## Adding modules later

From the root of a generated project:

```bash
npx create-expo-boilerplate add notifications
npx create-expo-boilerplate add notifications --dry-run   # list what would change, write nothing
```

| Module | What you get |
|---|---|
| `notifications` | Push (Firebase Cloud Messaging) and local notifications via NotifyKit: permission handling with a five-state banner, Android channels, foreground/background/killed delivery, allowlisted tap routing including cold start, token sync to your backend, tests. Docs land in `src/notifications/README.md`. |

`add` reads the stack from `boilerplate.json` (written by every new project; older projects are detected from their files) and writes the variant that fits: Expo Router or React Navigation, Unistyles / StyleSheet / Tailwind, TypeScript or JavaScript. It:

- refuses to run with uncommitted changes (`--force` overrides), so the module lands as one diff you can review;
- builds everything in a staging copy first, so a failure leaves the project untouched;
- patches the files it wires into (entry, `AppProviders`, `app.config.ts`, Jest config, translations). If one of them has been customised past recognition, it doesn't guess: it applies the rest and prints the edit to make by hand;
- refuses to add a module twice.

`notifications` flags: `--token-endpoint <path>` (default `devices/push-token`), `--google-services <path>` / `--google-service-info <path>` (Firebase files to copy into `firebase/`; prompted for, and skippable), `--banner` / `--no-banner` (permission banner on Settings), plus the shared `--yes`, `--dry-run`, `--force`, `--no-install`.

## How it works

The repo root **is** the template: the Expo Router + Zustand + TypeScript app with ESLint and Husky. Nobody maintains a second copy.

```
cli/
├── src/
│   ├── index.ts              # prompts + flags (commander, @clack/prompts)
│   ├── generate.ts           # runs the steps below in order
│   ├── template.ts           # copies the repo root (or the packaged template/)
│   └── steps/
│       ├── navigation.ts     # React Navigation: drop src/app, add the overlay, edit app.config + deps
│       ├── styling.ts        # StyleSheet / Tailwind: strip Unistyles, add the styling overlay, swap docs
│       ├── state.ts          # Redux: drop the Zustand store, add redux/common + thunk|saga overlays
│       ├── tooling.ts        # remove ESLint / Husky (+ lint-staged, Commitlint)
│       ├── identity.ts       # name, slug, scheme, bundle id
│       ├── packageManager.ts # lockfile, `yarn …` mentions, eas.json, .npmrc
│       ├── javascript.ts     # TS → JS with the TypeScript compiler, last
│       ├── readme.ts         # README for the exact stack chosen
│       └── format.ts         # Prettier with the project's .prettierrc
│   ├── add.ts                # `add <module>`: preflight, staging copy, JS pass, write back
│   ├── manifest.ts           # boilerplate.json (stack + added modules), detection fallback
│   └── modules/              # one generator per module, registered in index.ts
├── overlays/                 # files that differ per option, written in TypeScript
│   ├── react-navigation/
│   ├── redux/{common,thunk,saga}/
│   └── styling/{stylesheet,tailwind}/
│       ├── common/           #   styled components, screens, theme hooks (+ global.css, metro.config.js)
│       ├── expo-router/      #   route files that only exist with Expo Router
│       └── docs/             #   replacement sections for .skills/ui-creation.md and the screen snippet
├── modules/<name>/           # module sources: files/ (base stack), overlays/ (per option), translations/
└── scripts/
    ├── sync-template.mjs     # copies the repo root into template/ when packing
    └── test-matrix.mjs       # generates + checks every combination
```

- **Overlays are TypeScript only.** The JavaScript option transpiles the finished project with the TypeScript compiler (types erased, JSX untouched, blank lines kept), deletes files that only held types, and Prettier formats the result. There's no separate JS template to maintain.
- **Edits fail loudly.** Every string edit throws if its target text is missing, so if the boilerplate changes in a way a step depends on, generation (and CI) fails instead of shipping a half-converted project.
- **Region markers.** Option-specific blocks in the template are wrapped in `// @cli:<name>-start` … `// @cli:<name>-end` (or `<!-- @cli:… -->` in Markdown). The CLI either strips the markers and keeps the block, or replaces it:
  - `zustand` — the Zustand-only lint rule in `eslint.config.js`, swapped for the typed-Redux-hooks rule.
  - `unistyles` — Unistyles-only lines in `index.ts`, `babel.config.js`, `eslint.config.js` and `src/styles/themes.ts`, removed for StyleSheet / Tailwind.
  - `ui-*` and `snippet-screen` — styling sections of `.skills/ui-creation.md` and `.vscode/project.code-snippets`, replaced from `overlays/styling/<option>/docs/`.

  The test matrix fails if a marker survives into a generated project.

## Developing

```bash
cd cli
npm install
npm run build
node dist/index.js ../../my-test-app          # generates from the current repo root
```

Run from a checkout, the CLI copies the boilerplate straight from the repo root, so changes there show up in generated apps right away.

### Test every combination

```bash
npm run test:matrix            # 26 core combinations
npm run test:matrix -- --all   # all 144
npm run test:matrix -- --export   # also bundle each with `expo export` (slow)
npm run test:matrix -- --only redux-saga.react-navigation.tailwind
npm run test:matrix -- --add notifications   # also add a module to each, and check it refuses a second add
```

The script generates each project into your temp dir, installs **one** shared superset of dependencies, and checks each project for leftovers (stray markers, Zustand imports in Redux apps, Unistyles in StyleSheet / Tailwind apps, …), circular imports (madge), `tsc`, ESLint (or Prettier when ESLint is off), Jest, and `expo config`. CI runs the core set on every PR that touches the app or the CLI.

### Adding an option

1. Add the choice to `options.ts`, a prompt + flag in `index.ts`, and a step in `steps/` (or extend one).
2. Put files that differ in `overlays/<option>/`, in TypeScript, mirroring project paths.
3. Pin any new packages in `versions.ts`.
4. Add the dimension to `scripts/test-matrix.mjs` and run it.

### Adding a module

1. Put its sources in `modules/<name>/files/`, written for the base stack (Expo Router, Unistyles, TypeScript) and mirroring project paths; per-option replacements go in `modules/<name>/overlays/`.
2. Write a `ModuleGenerator` in `src/modules/<name>.ts` (prompts + flags, file copy, patches through `Patcher`, next steps) and register it in `src/modules/index.ts`.
3. Pin its packages in `versions.ts` — the test matrix installs them.
4. Run `npm run test:matrix -- --add <name>`. A patch that falls back to "do this by hand" fails the matrix.

### Upgrading the Expo SDK

Upgrade the boilerplate at the repo root as usual, then bump the overlay-only packages in `src/versions.ts` (React Navigation, Redux, Uniwind / Tailwind), and run `npm run test:matrix -- --all --export`.

## Publishing

Publishing is automatic: `.github/workflows/publish-cli.yml` publishes to npm on every push to `main`. It needs an `NPM_TOKEN` repository secret (an npm automation token, or a granular token with publish rights to this package).

- **The version comes from the commits**, the same way the GitHub release is versioned: git-cliff reads the Conventional Commits since the last `v*` tag (`feat` → minor, `fix` / `perf` → patch, `!` or `BREAKING CHANGE` → major), and `v1.1.0` is published as `1.1.0`. The `version` in `package.json` is set on the CI runner only, so don't bump it by hand.
- **A push with nothing releasable** (only `chore` / `docs` / `ci` commits) resolves to a version that is already on npm, so the run skips the publish with a notice instead of failing.
- Packages are published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), linking each version to the workflow run that built it.

To publish by hand instead (for example, to test a release):

```bash
cd cli
npm version 1.2.3 --no-git-tag-version
npm publish              # prepack builds dist/ and syncs template/
```

`prepack` compiles the CLI and copies the boilerplate into `template/`. npm drops `.gitignore` from tarballs, so it's stored as `_gitignore` and renamed back on generate. Check what ships with `npm pack --dry-run`.

To keep it private to the team, publish under a scope (`@your-org/create-expo-boilerplate`, run as `npm create @your-org/expo-boilerplate`) with restricted access.
