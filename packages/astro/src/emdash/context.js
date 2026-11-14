// Per-request state the `emdash` API reads: the preview token and the archive month of this request.
import { AsyncLocalStorage } from "node:async_hooks";

export const requestContext = new AsyncLocalStorage();
