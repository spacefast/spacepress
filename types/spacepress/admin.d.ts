// "spacepress/admin": SpacePress Admin screens, dashboard widgets, and dashboards.
import type { Action, AnyAction } from "./index.d.ts";

declare const screenBrand: unique symbol;
declare const itemBrand: unique symbol;

/** An `adminScreen()` value: registered by its export, like a kind or an action. */
export interface AdminScreen { readonly [screenBrand]: true }

/** `item("id")`: the field of the row a screen action runs on, compiled to the `{item.id}` placeholder. */
export type ItemRef<P extends string = string> = `{item.${P}}` & { readonly [itemBrand]: P };
export declare function item<const P extends string>(path: P): ItemRef<P>;

/** A DataViews field (docs/admin-screens.md). Its id is its key in `fields`. */
export interface ScreenField {
  label?: string;
  type?: "text" | "integer" | "number" | "boolean" | "datetime" | "array";
  elements?: readonly { value: string | number; label: string }[];
  description?: string;
}

type ScreenFields<F extends string> = { [K in F]: ScreenField };
type ActionInputOf<A> = A extends Action<infer I, any> ? I : never;
/** An action's input where any value may also be `item("field")`. */
type WithItems<T> =
  | ItemRef
  | (T extends readonly (infer E)[] ? readonly WithItems<E>[] : T extends object ? { [K in keyof T]: WithItems<T[K]> } : T);
type ScreenActionInput<A> = { [K in keyof ActionInputOf<A>]: WithItems<ActionInputOf<A>[K]> };

/** One action a screen runs, as the Ability the runtime registers for it (`<app>/<kebab name>`). */
export interface ScreenAction<A extends AnyAction = AnyAction> {
  id: string;
  label: string;
  action: A;
  /** The action's input; `item("field")` takes the row's value with its type. */
  input?: ScreenActionInput<A>;
  /** Defaults to the action's own `destructive`. */
  destructive?: boolean;
  /** A sentence asked before the action runs. */
  confirm?: string;
}

/** A DataViews view: which fields show, and how. */
export interface ScreenViewLayout<F extends string> {
  type?: "table" | "grid" | "list";
  fields?: readonly F[];
  titleField?: F;
  mediaField?: F;
  descriptionField?: F;
  sort?: { field: F; direction: "asc" | "desc" };
  perPage?: number;
  layout?: Record<string, unknown>;
}

/** A DataForm form: fields, or groups of them. */
export interface ScreenFormLayout<F extends string> {
  type?: "regular" | "panel" | "card";
  fields?: readonly (F | { id: string; label?: string; children: readonly F[] })[];
  labelPosition?: "top" | "side" | "none";
}

/** A list: a query whose output holds the rows. */
export interface ScreenView<A extends AnyAction, F extends string> {
  /** A `query()`; the build refuses a mutation here. */
  action: A;
  input?: ActionInputOf<A>;
  /** Dot path to the rows in the action's output; leave it out when the output is the list. */
  items?: string;
  /** The row key. Default `"id"`. */
  id?: string;
  fields: ScreenFields<F>;
  layout?: ScreenViewLayout<NoInfer<F>>;
}

/** A form: a query returns the values; `submit` runs with the edited ones as `item("field")`. */
export interface ScreenForm<A extends AnyAction, F extends string, S extends AnyAction> {
  action: A;
  input?: ActionInputOf<A>;
  /** Dot path to the values in the output. */
  item?: string;
  fields: ScreenFields<F>;
  layout?: ScreenFormLayout<NoInfer<F>>;
  submit?: ScreenAction<S>;
}

/** Who may open the screen: a SpacePress role, or a WordPress capability. Default administrators. */
type ScreenAccess =
  | { access?: "admin" | "editor" | "author" | "subscriber" | "authenticated"; capability?: never }
  | { capability: string; access?: never };

interface ScreenBase<TActions extends readonly AnyAction[]> {
  title: string;
  description?: string;
  /** Where wp-admin lists it (`parent`: a menu slug such as `"tools.php"`); `false` keeps it out of wp-admin. */
  classic?: false | { parent?: string; icon?: string; position?: number };
  /** Where SpacePress Admin's sidebar lists it; `false` keeps it out (its route still works). */
  menu?: false | { parent?: string; icon?: string; section?: string };
  /** Item actions, each one a SpacePress action run as its Ability. */
  actions?: { [K in keyof TActions]: ScreenAction<TActions[K]> };
  /** Fixed lines shown above the body. */
  data?: string | readonly string[];
}

export type AdminScreenDefinition<
  F extends string = string,
  TSource extends AnyAction = AnyAction,
  TActions extends readonly AnyAction[] = readonly AnyAction[],
  TSubmit extends AnyAction = AnyAction,
> = ScreenBase<TActions> & ScreenAccess & (
  | { view: ScreenView<TSource, F>; form?: never }
  | { form: ScreenForm<TSource, F, TSubmit>; view?: never }
);

/**
 * A SpacePress Admin screen, named by its export: `export const pendingOrders = adminScreen({ ... })` is
 * `/wp-admin/new/screens/pending-orders` and a wp-admin page. One React component draws it in both
 * admins; its actions run as Abilities, which check each action's own `access` (docs/admin-screens.md).
 */
export declare function adminScreen<
  F extends string,
  TSource extends AnyAction,
  const TActions extends readonly AnyAction[] = [],
  TSubmit extends AnyAction = AnyAction,
>(definition: AdminScreenDefinition<F, TSource, TActions, TSubmit>): AdminScreen;

declare const widgetBrand: unique symbol;
declare const dashboardBrand: unique symbol;

/** An `adminWidget()` value: registered by its export and placeable on any admin dashboard. */
export interface AdminWidget { readonly [widgetBrand]: true }

/** An `adminDashboard()` value: registered by its export as a custom dashboard or Home layout. */
export interface AdminDashboard { readonly [dashboardBrand]: true }

/** Built-in SpacePress dashboard widget types. */
export type BuiltinWidgetId =
  | "sp/content-overview"
  | "sp/recent-activity"
  | "sp/drafts-queue"
  | "sp/app-status"
  | "sp/store-pulse";

export interface WidgetMetric {
  id?: string;
  label: string;
  /** Dot path into the readonly action's response (e.g. `"totals.orders"`). */
  path: string;
  format?: "number" | "currency" | "percent" | "text";
}

export interface WidgetField {
  label?: string;
  type?: "text" | "integer" | "number" | "boolean" | "datetime";
  description?: string;
}

export type AdminWidgetDefinition<A extends AnyAction = AnyAction> = ScreenAccess & {
  title: string;
  description?: string;
  info?: string;
  /** A `query()` action that supplies the widget's data. */
  action: A;
  input?: ActionInputOf<A>;
  display?: "metrics" | "list" | "table" | "summary";
  /** Dot path to the list rows in the action's response (for `list` / `table` widgets). */
  items?: string;
  fields?: Record<string, WidgetField>;
  metrics?: readonly WidgetMetric[];
  /** Default grid column span (1–4). */
  width?: 1 | 2 | 3 | 4;
  /** Default grid row span (1–4). */
  height?: 1 | 2 | 3 | 4;
  link?: { label: string; to: string };
};

/** Declare a reusable dashboard widget backed by a query action. */
export declare function adminWidget<A extends AnyAction>(definition: AdminWidgetDefinition<A>): AdminWidget;

export type DashboardWidgetPlacement =
  | AdminWidget
  | BuiltinWidgetId
  | {
      widget: AdminWidget | BuiltinWidgetId;
      width?: 1 | 2 | 3 | 4;
      height?: 1 | 2 | 3 | 4;
      fullWidth?: boolean;
    };

export type AdminDashboardDefinition = ScreenAccess & {
  title: string;
  description?: string;
  /** Set `home: true` to customize the default Home (`/`) dashboard instead of adding a new route. */
  home?: boolean;
  /** Where SpacePress Admin's sidebar lists it; `false` hides it from the sidebar. */
  menu?: false | { icon?: string; section?: string };
  widgets: readonly [DashboardWidgetPlacement, ...DashboardWidgetPlacement[]];
};

/** Declare a custom admin dashboard (or override the default Home dashboard with `home: true`). */
export declare function adminDashboard(definition: AdminDashboardDefinition): AdminDashboard;
