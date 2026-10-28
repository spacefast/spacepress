// The one-line registration `zero build` generates into zero.gen.ts.
import type { relations } from "./schema";
declare module "zero" { interface Register { relations: typeof relations } }
