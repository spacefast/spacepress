// The registration `zero build` generates into zero.gen.ts. `config` types `db.globals`.
import type { relations } from "./schema";
import type config from "./inference";
declare module "zero" { interface Register { relations: typeof relations; config: typeof config } }
