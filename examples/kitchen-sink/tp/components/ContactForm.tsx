"use client";

import { useState } from "typedpress/client";
import { contactKitchen } from "../server";

// Calls the `contactKitchen` mutation (tp/server.ts): it checks the fields and queues the mail to
// the kitchen in the request's transaction.
export function ContactForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("idle");
  const send = async (event: SubmitEvent) => {
    event.preventDefault();
    setStatus("sending");
    try {
      await contactKitchen({ email, message });
      setStatus("sent");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <form onSubmit={send}>
      <label>Email <input type="email" required value={email} onInput={(event: InputEvent) => { setEmail((event.target as HTMLInputElement).value); }} /></label>
      <label>Message <textarea required minLength={3} maxLength={2000} value={message} onInput={(event: InputEvent) => { setMessage((event.target as HTMLTextAreaElement).value); }} /></label>
      <button disabled={status === "sending"}>Send</button>
      <p role="status">{status === "sent" ? "Thanks. We read every message." : status === "failed" ? "That did not send. Try again in a moment." : ""}</p>
    </form>
  );
}
