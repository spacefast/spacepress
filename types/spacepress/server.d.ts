// "spacepress/server": server-only runtime APIs (compiled to PHP by SpacePress).
// Never import this module from "use client" components or browser bundles.
import type {
  AccessCtx,
  AnyFileBucket,
  Awaitable,
  Database,
  EnqueueOptions,
  FieldAccessCtx,
  FileBucket,
  FileRule,
  HookCtx,
  Id,
  JobCtx,
  Locale,
  MailAddress,
  MailMessage,
  PrivateFileInfo,
  Role,
  RouteQuery,
  RouteRequest,
  RouteResponse,
  Status,
  User,
  ValidateCtx,
} from "./index.d.ts";

export type {
  AccessCtx,
  AnyFileBucket,
  Database,
  EnqueueOptions,
  FieldAccessCtx,
  FileBucket,
  FileRule,
  HookCtx,
  Id,
  JobCtx,
  Locale,
  MailAddress,
  MailMessage,
  PrivateFileInfo,
  Role,
  RouteQuery,
  RouteRequest,
  RouteResponse,
  Status,
  User,
  ValidateCtx,
};

/** Trusted database handle available inside hooks, actions, routes, pages, and jobs. */
export declare const db: Database;

/** Throw from a hook, action, or route to choose the HTTP response. */
export declare class HttpError extends Error {
  /** `pointer` names the input field the error is about (`"/email"`), so a form shows it beside that field. */
  constructor(status: number, code: string, message: string, pointer?: string);
  readonly status: number;
  readonly code: string;
}

/** Run an idempotent side effect once per key inside a background job or handler. */
export declare function once<T>(key: string, fn: () => Awaitable<T>): Promise<T>;

/**
 * Email from hooks, actions, routes and jobs. `send` queues the message in the handler's
 * transaction and hands it to the site's mail transport after commit, retrying a refusal; a
 * rollback sends nothing. It resolves to the queued delivery's id, or `""` while a preview binding
 * seeds, which checks the message and queues nothing. `render` turns a React Email
 * template from `emails/` into the `html` and `text` a message carries.
 */
export declare const mail: {
  send(message: MailMessage): Promise<{ id: string }>;
  /** The HTML and plain text of an `emails/` template's default export, rendered with `props`. */
  render<P>(template: (props: P) => unknown, props: P): { html: string; text: string };
};

/**
 * Host-managed connectors (a Space's Slack, GitHub, …), reached through the host's
 * `sp_connectors_call` filter. Credentials stay with the host.
 */
export declare const connectors: {
  call(role: string, tool: string, args?: Record<string, unknown>): Promise<unknown>;
  enqueue(
    role: string,
    tool: string,
    args?: Record<string, unknown>,
    options?: { key?: string; delay?: number },
  ): Promise<{ id: string }>;
};
