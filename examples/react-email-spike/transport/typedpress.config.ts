import { action, defineConfig, mail, text } from "typedpress";

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

export default defineConfig({ name: "react-email-transport" });
