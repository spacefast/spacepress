---
uid: zr_95de60f8f35ceef22490
title: Install
description: Add First to a project.
order: 1
status: published
publishedAt: 2026-11-14T04:35:37.000Z
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
