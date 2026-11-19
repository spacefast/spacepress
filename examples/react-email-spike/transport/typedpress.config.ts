import { action, defineConfig, mail, text } from "typedpress";
import Welcome from "./emails/welcome";

export const invite = action({
  access: "anyone",
  input: { html: text(), plainText: text() },
  async handler({ html, plainText }) {
    return (await mail.send({
      to: "guest@example.test",
      subject: "Organization invitation",
      html,
      text: plainText,
    })).id;
  },
});

export const welcome = action({
  access: "anyone",
  input: { email: text(), name: text(), dashboardUrl: text() },
  async handler({ email, name, dashboardUrl }) {
    const { html, text } = mail.render(Welcome, { name, dashboardUrl, siteName: "Example site" });
    return (await mail.send({ to: email, subject: `Welcome, ${name}`, html, text })).id;
  },
});

export default defineConfig({ name: "react-email-transport" });
