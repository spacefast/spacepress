// mail.send and mail.render via MutationCtx.
import { mutation, type MailMessage } from "spacepress";

declare const replyTo: string | null;
declare const name: string | undefined;

export const fromSettings: MailMessage = { to: "a@example.test", subject: "Hello", text: "Hi", replyTo };
export const absent: MailMessage = { to: { email: "a@example.test", name }, subject: "Hello", html: "<p>Hi</p>", from: undefined, cc: null };

// @ts-expect-error a message needs someone to send to
export const noRecipient: MailMessage = { subject: "Hello", text: "Hi" };
// @ts-expect-error an address is a string or { email, name? }
export const wrongAddress: MailMessage = { to: 3, subject: "Hello", text: "Hi" };

const Welcome = (props: { name: string }) => props.name;

export const sendEmail = mutation({ access: "admin" }, async ({ mail }) => {
  const queued: Promise<{ id: string }> = mail.send(fromSettings);
  const rendered: { html: string; text: string } = mail.render(Welcome, { name: "Ada" });
  // @ts-expect-error the props are the template's
  const wrongProps = mail.render(Welcome, { title: "Ada" });
  void [queued, rendered, wrongProps];
  return await queued;
});
