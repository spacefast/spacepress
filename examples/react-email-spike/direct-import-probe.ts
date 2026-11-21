import { action, defineConfig, mail, text } from "typedpress";
import { createElement } from "react";
import { render, toPlainText } from "react-email";
import Invitation from "./emails/invitation";

export const invite = action({
  access: "editor",
  input: { name: text(), url: text(), to: text() },
  async handler({ name, url, to }) {
    const html = await render(createElement(Invitation, { name, url }));
    const plainText = toPlainText(html);
    return await mail.send({ to, subject: "Organization invitation", html, text: plainText });
  },
});

export default defineConfig({ name: "react-email-spike" });
