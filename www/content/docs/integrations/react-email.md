---
uid: zr_b8218b94d9e38e5891cc
title: React Email Templates
description: Render emails/*.tsx templates with mail.render() and deliver transactional email with mail.send().
order: 3
status: published
publishedAt: 2026-11-21T09:11:00.000Z
---
## Authoring templates in `emails/`

Write transactional email templates using `react-email` components under `emails/*.tsx`:

```tsx
import { Body, Button, Html, Text } from "react-email";

export default function Invitation({ name, url }: { name: string; url: string }) {
  return (
    <Html lang="en">
      <Body>
        <Text>Hello, {name}!</Text>
        <Button href={url}>Accept invitation</Button>
      </Body>
    </Html>
  );
}
```

## Transactional sending

Import the template's default export and `mail` from `"spacepress/server"`. `mail.render(Template, props)` returns `{ html, text }`; `mail.send()` queues the message:

```ts
// sp/server.ts
import { mutation } from "spacepress";
import { mail } from "spacepress/server";
import Invitation from "../emails/invitation";

export const invite = mutation({ access: "editor" }, async ({ name, email, url }: { name: string; email: string; url: string }) => {
  const rendered = mail.render(Invitation, { name, url });
  await mail.send({ to: email, subject: "You're invited", html: rendered.html, text: rendered.text });
  return { sent: true };
});
```

`mail.send()` queues the message in the current database transaction and hands it to the site's mail transport after commit, retrying a refusal. If the hook, query or mutation rolls back, nothing is sent. Without a host transport, messages go through WordPress's `wp_mail()`.
