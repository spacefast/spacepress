// A taxonomy with a URL pattern: its rule is registered on every boot and flushed by initialize,
// like a kind's.
import { taxonomy } from "first";

export const topics = taxonomy({}, { url: "/topics/:slug" });
