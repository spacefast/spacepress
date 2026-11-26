# `@spacepress/client`

Typed browser, Node, Bun, and Deno client SDK and React hooks for SpacePress apps.

The main `spacepress` package also re-exports these entrypoints as **`spacepress/client`** and **`spacepress/react`** (matching Convex's single-package layout). Install `@spacepress/client` directly when an external frontend (Next.js, Astro, Vite, mobile) wants only the zero-dependency browser runtime without the CLI.

- **`spacepress/client` / `@spacepress/client`** — `bind(SCHEMA)` / `createClient(SCHEMA, options?)`, `SpacePressError`, `watch`, `pageRead`, `registerRealtimeTransport`, and WordPress Abilities execution (`/wp-json/wp-abilities/v1/abilities/<app>/<name>/run`).
- **`spacepress/react` / `@spacepress/client/react`** — React hooks (`useLive`, `useMutation`, `createHooks(React)`, `useMount`, `useEvent`, `sharedState`, `uploadFile`) that accept typed references from `<dir>/_generated/api` and work both in SpacePress Interactivity API `"use client"` components and in external React apps.

## Usage

### Typed client (external frontend or browser entry)

```ts
import { bind } from "spacepress/client"; // or "@spacepress/client"
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

### React hooks with generated `api`

```tsx
"use client";
import { useState } from "react";
import { useLive, useMutation } from "spacepress/react"; // or "@spacepress/client/react"
import { api } from "../_generated/api";

export function OpenTasks() {
  const [title, setTitle] = useState("");
  const tasks = useLive(api.tasks.list({ limit: 20 }));
  const add = useMutation(api.actions.addTask);
  return (
    <div>
      <button disabled={add.pending} onClick={() => add.mutate({ title })}>
        Add ({tasks.data?.length ?? 0})
      </button>
    </div>
  );
}
```
