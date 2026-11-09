---
title: Working with AI assistants
description: How the React Native Expo Boilerplate helps AI coding assistants like Claude Code, Cursor and Copilot write code that follows the project's conventions.
---

AI coding assistants write better code when they know a project's rules. The boilerplate ships those rules as plain Markdown in `.skills/`, so Claude Code, Cursor, Copilot, Codex or Aider can follow the same conventions your team does.

## The guides

| File | Covers |
| --- | --- |
| `.skills/api-hook-creation.md` | Adding API hooks: folder layout, react-query-kit patterns, what the shared client already handles, pagination, mutations |
| `.skills/ui-creation.md` | Building screens and components: where files go, theme tokens, text styles, scaling, `ScreenWrapper` rules, a review checklist |
| `.skills/localization.md` | Adding and using translations, typed keys, language switching and RTL |

`ui-creation.md` is rewritten by the CLI for the styling option you choose, so the assistant gets Unistyles, StyleSheet or Tailwind instructions to match your app.

## How to use them

Point your assistant at the relevant file when you ask for something:

> Read `.skills/api-hook-creation.md`, then add a hook that fetches a user's orders from `GET users/:id/orders`.

Or add them to your tool's project rules (Cursor rules, Copilot instructions, `CLAUDE.md` or `AGENTS.md`) so they're always loaded.

## Why it works well with AI

- **One place for everything.** Each feature is a single folder with a clear public API, so an assistant can change one feature without touching others.
- **Guard rails catch mistakes.** Typed routes, typed translation keys, strict TypeScript, ESLint rules and Zod-validated env vars turn most AI mistakes into immediate errors instead of runtime bugs.
- **Fail-loud tooling.** `yarn lint && yarn type-check && yarn test` is a quick, reliable check after any AI-generated change.
- **`AGENTS.md`** at the root reminds assistants to read the docs for the exact Expo SDK version in use, since Expo APIs change between releases.
