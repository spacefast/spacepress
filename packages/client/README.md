# `@spacepress/client`

Typed browser, Node, Bun, and Deno client SDK and React hooks for SpacePress apps.

- **`@spacepress/client`** — `bind(SCHEMA)` / `createClient(SCHEMA, options?)`, `SpacePressError`, `watch`, `pageRead`, `registerRealtimeTransport`, and WordPress Abilities execution (`/wp-json/wp-abilities/v1/abilities/<app>/<name>/run`).
- **`@spacepress/client/react`** — React hooks for external React apps (`createHooks(React)` → `useQuery`, `useMutation`) and SpacePress `"use client"` hooks (`useLive`, `useMount`, `useEvent`, `sharedState`, `uploadFile`) that both compile to WordPress Interactivity API directives in `spacepress build` and run in React/tests/Storybook.

## Usage

### Typed client (external frontend or browser entry)

```ts
import { bind } from "@spacepress/client";
import { SCHEMA } from "./sp/_generated/client/schema.ts";
import type * as Types from "./sp/_generated/client/types.ts";

export const createClient = bind<{
  collections: Types.Collections;
  globals: Types.Globals;
  actions: Types.Actions;
  schema: typeof SCHEMA;
}>(SCHEMA);

const sp = createClient({ url: "https://example.com" });
const posts = await sp.posts.list({ limit: 10 });
```

### React hooks

```tsx
"use client";
import { useState } from "react";
import { useLive } from "@spacepress/client/react";

export function OpenTasks() {
  const [filter, setFilter] = useState("all");
  const tasks = useLive("tasks", { limit: 20 });
  return <div>{tasks.data?.length ?? 0}</div>;
}
```
