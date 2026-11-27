// "spacepress/server": server-only runtime APIs (compiled to PHP by SpacePress).
// Never import this module from "use client" components or browser bundles.
import type {
  AccessCtx,
  AnyFileBucket,
  Connectors,
  Db,
  EnqueueOptions,
  FieldAccessCtx,
  FileBucket,
  FileRule,
  Files,
  HookCtx,
  Id,
  JobCtx,
  Locale,
  Mail,
  MailAddress,
  MailMessage,
  MutationCtx,
  Once,
  PrivateFileInfo,
  QueryCtx,
  ReadOnlyDb,
  Role,
  RouteCtx,
  RouteQuery,
  RouteRequest,
  RouteResponse,
  Status,
  SystemDb,
  SystemReadOnlyDb,
  User,
  ValidateCtx,
} from "./index.d.ts";

export type {
  AccessCtx,
  AnyFileBucket,
  Connectors,
  Db,
  EnqueueOptions,
  FieldAccessCtx,
  FileBucket,
  FileRule,
  Files,
  HookCtx,
  Id,
  JobCtx,
  Locale,
  Mail,
  MailAddress,
  MailMessage,
  MutationCtx,
  Once,
  PrivateFileInfo,
  QueryCtx,
  ReadOnlyDb,
  Role,
  RouteCtx,
  RouteQuery,
  RouteRequest,
  RouteResponse,
  Status,
  SystemDb,
  SystemReadOnlyDb,
  User,
  ValidateCtx,
};

/**
 * Database handle for async React Server Components (`sp/components/*.tsx`) and standalone helpers.
 * Inside `query()`, `mutation()`, `job()`, `cron()`, `page.tsx`, `route.ts`, `.on()` hooks, and
 * `access` rules, prefer the capability-typed `db` passed on `ctx` / props.
 */
export declare const db: Db;

/** Throw from a hook, query, mutation, or route to choose the HTTP response. */
export declare class HttpError extends Error {
  /** `pointer` names the input field the error is about (`"/email"`), so a form shows it beside that field. */
  constructor(status: number, code: string, message: string, pointer?: string);
  readonly status: number;
  readonly code: string;
}
