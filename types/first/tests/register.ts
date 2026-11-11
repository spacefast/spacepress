// The registration `first build` generates into first/_generated/db.d.ts. `config` types globals and jobs.
import type { relations } from "./schema";
import type config from "./inference";
declare module "first" { interface Register { relations: typeof relations; config: typeof config; locales: "en" | "de" } }
