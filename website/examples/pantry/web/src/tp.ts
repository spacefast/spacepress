// One client for the whole frontend. It carries the data calls and sign-in.
import { createClient } from "@typedpress/client";

export const tp = createClient({ url: import.meta.env.VITE_PANTRY_URL });
