import { defineConfig, mutation } from "spacepress";
import Welcome from "./emails/welcome";

export const invite = mutation({ access: "anyone" }, async ({ mail }, { html, plainText }: {
  html: string;
  plainText: string;
}) => {
  return (await mail.send({
    to: "guest@example.test",
    subject: "Organization invitation",
    html,
    text: plainText,
  })).id;
});

export const welcome = mutation({ access: "anyone" }, async ({ mail }, { email, name, dashboardUrl }: {
  email: string;
  name: string;
  dashboardUrl: string;
}) => {
  const { html, text } = mail.render(Welcome, { name, dashboardUrl, siteName: "Example site" });
  return (await mail.send({ to: email, subject: `Welcome, ${name}`, html, text })).id;
});

export default defineConfig({ name: "react-email-transport" });
