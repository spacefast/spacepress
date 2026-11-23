import { defineConfig, mail, mutation } from "spacepress";
import { createElement } from "react";
import { render, toPlainText } from "react-email";
import Invitation from "./emails/invitation";

export const invite = mutation({ access: "editor" }, async ({ name, url, to }: {
  name: string;
  url: string;
  to: string;
}) => {
  const html = await render(createElement(Invitation, { name, url }));
  const plainText = toPlainText(html);
  return await mail.send({ to, subject: "Organization invitation", html, text: plainText });
});

export default defineConfig({ name: "react-email-spike" });
