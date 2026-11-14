---
title: Install
order: 1
description: Add First to a project.
---

<Callout type="tip" title="Before you start">
You need **Node 22** and a WordPress site.
</Callout>

```sh group="install"
npm install first
```

```sh title="pnpm" group="install"
pnpm add first
```

## Configure

```ts title="first.config.ts" {2}
import { defineConfig } from "first";
export default defineConfig({ name: "docs" });
```
