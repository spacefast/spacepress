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

Call `mail.render(Template, props)` to produce `{ html, text }`, then queue delivery with `mail.send()`:

```ts
const rendered = mail.render(Invitation, { name, url });
await mail.send({
  to: recipientEmail,
  subject: "You're invited",
  html: rendered.html,
  text: rendered.text,
});
```

`mail.send()` queues the message inside the current database transaction and dispatches it after commit with retries — if a hook or action rolls back, no email is sent.
