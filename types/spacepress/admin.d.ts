// "spacepress/admin": SpacePress Admin screens, dashboard widgets, and dashboards.
import type { AnyAction, Role } from "./index.d.ts";

declare const screenBrand: unique symbol;
declare const itemBrand: unique symbol;
declare const widgetBrand: unique symbol;
declare const dashboardBrand: unique symbol;

export interface AdminScreen {
  readonly [screenBrand]: true;
}

export type ItemRef<P extends string = string> = `{item.${P}}` & { readonly [itemBrand]: P };
export declare function item<const P extends string>(path: P): ItemRef<P>;

export interface ScreenField {
  key: string;
  label?: string;
  format?: "text" | "number" | "currency" | "date" | "datetime" | "badge" | "boolean" | "link" | "code";
  align?: "left" | "right";
  width?: number;
  badge?: Record<string, "default" | "success" | "warning" | "danger" | "info">;
  href?: string;
  empty?: string;
  hideOnMobile?: boolean;
}

export interface ScreenAction<A extends AnyAction = AnyAction> {
  label: string;
  action: A;
  input?: Record<string, unknown>;
  confirm?: string | { title?: string; message: string; confirmLabel?: string };
  tone?: "default" | "primary" | "danger";
  icon?: string;
  when?: { field: string; equals?: unknown; in?: readonly unknown[] };
}

export interface ScreenViewLayout<F extends string> {
  kind: "table" | "cards" | "list";
  columns?: readonly (F | ScreenField)[];
  title?: F;
  subtitle?: F;
  badge?: F;
  meta?: readonly (F | ScreenField)[];
  empty?: string;
  search?: boolean;
}

export interface ScreenFormLayout<F extends string> {
  fields?: readonly { key: F; label?: string; description?: string; placeholder?: string; rows?: number }[];
  submitLabel?: string;
}

export interface ScreenView<A extends AnyAction, F extends string> {
  label?: string;
  query: A;
  input?: Record<string, unknown>;
  items?: string;
  itemKey?: F;
  layout?: ScreenViewLayout<F>;
  rowActions?: readonly ScreenAction[];
  bulkActions?: readonly ScreenAction[];
  toolbarActions?: readonly ScreenAction[];
}

export interface ScreenForm<A extends AnyAction, F extends string, S extends AnyAction> {
  label?: string;
  action: A;
  initial?: S;
  layout?: ScreenFormLayout<F>;
  successMessage?: string;
}

type ScreenAccess = { access?: Role | "authenticated" };

export type AdminScreenDefinition<
  Q extends AnyAction = AnyAction,
  M extends AnyAction = AnyAction,
  S extends AnyAction = AnyAction,
  F extends string = string,
> = ScreenAccess & {
  title: string;
  description?: string;
  icon?: string;
  group?: string;
  order?: number;
  slug?: string;
  views?: Record<string, ScreenView<Q, F>>;
  form?: ScreenForm<M, F, S>;
} & (
    | { query: Q; input?: Record<string, unknown>; items?: string; itemKey?: F; layout?: ScreenViewLayout<F>; rowActions?: readonly ScreenAction[]; bulkActions?: readonly ScreenAction[]; toolbarActions?: readonly ScreenAction[] }
    | { views: Record<string, ScreenView<Q, F>> }
    | { form: ScreenForm<M, F, S> }
  );

export declare function adminScreen<
  Q extends AnyAction = AnyAction,
  M extends AnyAction = AnyAction,
  S extends AnyAction = AnyAction,
  F extends string = string,
>(definition: AdminScreenDefinition<Q, M, S, F>): AdminScreen;

export interface AdminWidget {
  readonly [widgetBrand]: true;
}

export interface AdminDashboard {
  readonly [dashboardBrand]: true;
}

export type BuiltinWidgetId =
  | "site-overview"
  | "recent-activity"
  | "quick-actions"
  | "drafts"
  | "comments"
  | "health";

export interface WidgetMetric {
  label: string;
  value: string;
  format?: "number" | "currency" | "percent" | "text";
  trend?: string;
  href?: string;
}

export interface WidgetField {
  key: string;
  label?: string;
  format?: "text" | "number" | "currency" | "date" | "datetime" | "badge" | "boolean";
  href?: string;
}

export type AdminWidgetDefinition<A extends AnyAction = AnyAction> = ScreenAccess & {
  title: string;
  description?: string;
  icon?: string;
  query: A;
  input?: Record<string, unknown>;
  size?: "sm" | "md" | "lg" | "full";
  refresh?: number;
  href?: string;
  empty?: string;
} & (
    | { kind: "metrics"; metrics: readonly WidgetMetric[] }
    | { kind: "list"; items?: string; fields: readonly (string | WidgetField)[]; limit?: number }
    | { kind: "chart"; items?: string; x: string; y: string; chart?: "bar" | "line" | "area" }
    | { kind: "status"; status: string; message?: string; items?: readonly { label: string; value: string; tone?: "default" | "success" | "warning" | "danger" }[] }
  );

export declare function adminWidget<A extends AnyAction>(definition: AdminWidgetDefinition<A>): AdminWidget;

export interface DashboardWidgetPlacement {
  widget: AdminWidget | BuiltinWidgetId;
  span?: 1 | 2 | 3 | 4;
}

export type AdminDashboardDefinition = ScreenAccess & {
  title?: string;
  description?: string;
  columns?: 2 | 3 | 4;
  widgets: readonly (AdminWidget | BuiltinWidgetId | DashboardWidgetPlacement)[];
};

export declare function adminDashboard(definition: AdminDashboardDefinition): AdminDashboard;
