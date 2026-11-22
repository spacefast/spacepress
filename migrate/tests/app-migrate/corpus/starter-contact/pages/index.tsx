"use client";

import { useMutation } from "@spacefast/zero/client";
import { Alert, Button, Card, Field, Input, TextArea } from "@spacefast/zero/kit";
import { useState } from "preact/hooks";

import { cleanSubmission, type SubmissionInput } from "../shared/contact";

export default function ContactPage() {
  const submit = useMutation<[input: SubmissionInput], { ok: boolean }>("submit");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "invalid">("idle");

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const input = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      message: String(data.get("message") ?? ""),
    };
    if (!cleanSubmission(input)) {
      setState("invalid");
      return;
    }
    setState("sending");
    const result = await submit(input);
    setState(result.ok ? "sent" : "invalid");
    if (result.ok) form.reset();
  }

  return (
    <Card title="Contact" subtitle="Submissions land in this capsule's database.">
      <div class="flex flex-col gap-4">
        {state === "sent" ? (
          <Alert tone="success" title="Message sent">
            Thanks — we read every note.
          </Alert>
        ) : null}
        {state === "invalid" ? (
          <Alert tone="danger" title="Not quite">
            Every field is required, and the email needs an @ in it.
          </Alert>
        ) : null}
        <form class="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
          <Field label="Name" htmlFor="contact-name">
            <Input id="contact-name" name="name" autocomplete="name" />
          </Field>
          <Field label="Email" htmlFor="contact-email">
            <Input id="contact-email" name="email" type="email" autocomplete="email" />
          </Field>
          <Field label="Message" htmlFor="contact-message" hint="What can we help with?">
            <TextArea id="contact-message" name="message" rows={5} />
          </Field>
          <div class="flex justify-end">
            <Button type="submit" loading={state === "sending"}>
              Send message
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
