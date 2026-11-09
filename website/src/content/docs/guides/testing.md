---
title: Testing & code quality
description: Jest with React Native Testing Library, ESLint 9, Prettier, Husky git hooks and Commitlint in the React Native Expo Boilerplate.
---

## Commands

```bash
yarn test              # run all tests
yarn test:watch        # watch mode
yarn test:coverage     # coverage report
yarn lint              # ESLint
yarn lint:fix          # ESLint with auto-fix
yarn type-check        # TypeScript, no output
```

## Tests

Tests use **jest-expo** and **React Native Testing Library**. Native modules like MMKV and expo-secure-store are mocked in `jest.setup.ts`, so tests run without a native build. `@env` points to a mock in `__mocks__/`.

Examples to copy:

| Test | Shows |
| --- | --- |
| `src/shared/utils/__tests__/scale.test.ts` | Pure functions |
| `src/features/auth/store/__tests__/useUserStore.test.ts` | A Zustand store |
| `src/services/__tests__/utils.test.ts` | Pagination helpers |
| `src/shared/utils/__tests__/appLoader.test.ts` | The app loader |

Redux apps get slice tests, and saga tests if you chose Saga.

```tsx
import { render, screen } from '@testing-library/react-native';
import Button from '@/shared/components/Button';

it('renders the title', () => {
  render(<Button title="Submit" onPress={() => {}} />);
  expect(screen.getByText('Submit')).toBeOnTheScreen();
});
```

Put tests in a `__tests__/` folder next to the code they test.

## ESLint rules that matter

ESLint 9 with flat config, plus a few project rules:

- **No deep imports into features.** Import `@/features/auth`, not `@/features/auth/store/useUserStore`.
- **Atomic Zustand selectors.** `useStore((s) => s.field)`, never `useStore()`, which re-renders on every change. Redux apps get a rule requiring the typed `useAppDispatch` and `useAppSelector` instead.
- **Sorted imports and no unused imports**, fixed automatically by `yarn lint:fix`.
- **Prettier** formatting runs as an ESLint rule, so one command fixes both.

## Git hooks (Husky)

If you kept Husky, these run automatically:

| Hook | Does |
| --- | --- |
| `pre-commit` | Blocks direct commits to `main` or `master`, runs `yarn type-check`, and lints the staged files |
| `commit-msg` | Checks the message follows Conventional Commits |
| `post-merge` | Runs `yarn install` if `yarn.lock` changed in the pull |

To commit to `main` on purpose, for example in a solo project, set `SKIP_BRANCH_PROTECTION=1`.

## Commit messages

```
feat: add biometric login
fix: refresh token race condition
chore: upgrade Expo SDK
docs: explain env setup
```

`feat` and `fix` drive automatic version bumps and changelogs. See [EAS builds & releases](../eas/#versioning-and-github-releases).
