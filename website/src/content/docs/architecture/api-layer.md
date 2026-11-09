---
title: API layer
description: The shared Axios client, TanStack Query and react-query-kit hooks in the React Native Expo Boilerplate, with auth tokens, 401 handling, request cancellation and pagination.
---

Everything that talks to your backend goes through two pieces:

- **`client`** in `src/services/client.ts`: one Axios instance with all the cross-cutting behaviour.
- **react-query-kit hooks** in each feature's `api/` folder, built on TanStack Query v5.

Screens only call the hooks and render loading, error and data states. Never import `axios` anywhere else.

## The shared client

`client` uses `EXPO_PUBLIC_API_URL` as its base URL and handles:

| Concern | What it does |
| --- | --- |
| **Auth token** | Reads the access token from encrypted storage and adds it to every request |
| **Connectivity** | Checks the network before sending, so offline requests fail immediately instead of after a 30-second timeout |
| **401 responses** | By default clears tokens, logs the user out and shows a "Session expired" alert, once even if many requests fail together. With token refresh on, it refreshes silently and retries the queued requests |
| **Cancellation** | Every fetcher passes React Query's `AbortSignal`, so requests are cancelled when a screen unmounts or a query key changes |
| **Error toasts** | Parses common API error shapes and shows a readable message |
| **Dev logging** | Logs requests and responses in development builds |

### Turning on token refresh

If your API has a refresh endpoint, set `ENABLE_TOKEN_REFRESH = true` in `src/services/client.ts` and adjust the refresh request to match your API. Failed requests are queued and retried once after a successful refresh (`MAX_RETRIES`). Store tokens after login with `setTokens(accessToken, refreshToken)` from `@/storage/token`.

## Writing a query

```ts title="src/features/todos/api/use-todos.ts"
import { createQuery } from 'react-query-kit';

import { client } from '@/services';

import type { Todo } from './types';

export const useTodos = createQuery<Todo[]>({
  queryKey: ['todos'],
  fetcher: (_, { signal }) => client.get('todos', { signal }).then((r) => r.data),
});
```

Export it from the feature's `index.ts`, then use it in a screen:

```tsx
const { data, isLoading, error, refetch } = useTodos();
```

## A query with variables

Queries that need input take `variables`. Use `enabled` to wait until you have them:

```ts
export const usePost = createQuery<Post, { id: number }>({
  queryKey: ['posts', 'detail'],
  fetcher: ({ id }, { signal }) => client.get(`posts/${id}`, { signal }).then((r) => r.data),
});

// in a screen
const { data } = usePost({ variables: { id: selectedId! }, enabled: selectedId != null });
```

## Mutations

```ts
import { createMutation } from 'react-query-kit';

export const useAddPost = createMutation<Post, { title: string; body: string }>({
  mutationFn: (variables) => client.post('posts/add', variables).then((r) => r.data),
});

// in a screen
const { mutate, isPending } = useAddPost({
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['posts'] }),
});
```

## Infinite lists

`src/services` has helpers for APIs that page with `limit` and `skip`:

| Helper | Use |
| --- | --- |
| `DEFAULT_LIMIT` | Page size (10) |
| `getNextPageParam` / `getPreviousPageParam` | Work out the next `skip` from the last page's meta |
| `normalizePages(pages, key)` | Flatten `data.pages` into one array for a `FlatList` |
| `PaginateQuery<K, T>` | Type for a page response such as `{ posts: Post[], total, skip, limit }` |

```ts
export const useInfinitePosts = createInfiniteQuery<PostsPage, { limit?: number }>({
  queryKey: ['posts', 'infinite'],
  fetcher: (variables, { pageParam, signal }) =>
    client
      .get('posts', { signal, params: { limit: variables?.limit ?? DEFAULT_LIMIT, skip: pageParam } })
      .then((r) => r.data),
  initialPageParam: 0,
  getNextPageParam,
  getPreviousPageParam,
});

// in a screen
const { data, fetchNextPage, hasNextPage } = useInfinitePosts();
const posts = normalizePages(data?.pages, 'posts');
```

If your API pages differently (cursors, page numbers), change these helpers once and every list follows.

## The example feature

`src/features/posts/api` calls [DummyJSON](https://dummyjson.com/docs) so the app shows real data on first run:

| Hook | Request | Shows |
| --- | --- | --- |
| `usePosts()` | `GET posts` | The simplest list query |
| `useInfinitePosts()` | `GET posts?limit=10&skip=…` | Paginated list that loads more on scroll |
| `usePost({ variables: { id } })` | `GET posts/:id` | A query that runs only once a post is tapped |
| `useAddPost()` | `POST posts/add` | A mutation |

Point `EXPO_PUBLIC_API_URL` at your backend and replace this feature with your own.

## Query defaults

`src/services/api-provider.tsx` creates the `QueryClient` with sensible defaults: data stays fresh for 5 minutes (`staleTime`), unused data is kept for 10 minutes (`gcTime`), queries retry twice, and **mutations never retry automatically**, because repeating a POST can create duplicates. Override any of these per hook.

## VS Code snippets

The project ships snippets in `.vscode/` for the common patterns:

| Prefix | Creates |
| --- | --- |
| `useq` | A query hook |
| `useqv` | A query hook with variables |
| `useiq` | An infinite query hook |
| `usem` | A mutation hook |
| `rnfu` | A screen component |

The [AI assistant guide](../../guides/ai-assistants/) for API hooks covers the same patterns.
