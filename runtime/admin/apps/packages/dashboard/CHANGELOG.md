<!-- Learn how to maintain this file at https://github.com/WordPress/gutenberg/tree/HEAD/packages#maintaining-changelogs. -->
<!-- markdownlint-configure-file { "MD024": { "siblings_only": true } } -->

# Changelog

## Unreleased

### Enhancements

-   Add `rowHeight` prop to `Dashboard` for configuring grid row height. Accepts a number (pixels) or `'auto'` for content-sized rows. Defaults to 200.
-   Add `fillWidth` and `fullWidth` properties to `DashboardWidget` for flexible column spanning. `fillWidth` spans remaining columns in the current row; `fullWidth` spans all columns. Mutually exclusive via discriminated union, mirroring `@automattic/grid`'s `GridLayoutItem`.
-   Bump `@automattic/grid` to 0.2.0.
-   Add `onClick` prop to `Dashboard.Actions` for tracking button interactions. Fires before the state change with the action type (`'customize'`, `'done'`, `'cancel'`, `'add-widget'`). [#3862]([upstream private reference omitted])
-   Add `useDashboardWidget` hook exposing widget identity (`uid`, `name`, `position`) via React context. Wraps each widget in a `WidgetContextProvider`. [#3726](https://github.com/niceplugin/zero-admin/pull/3726)
-   Emit `dashboard.widgetRendered` action on widget mount for telemetry and external consumers. Fires once per widget via ref guard. [#3729](https://github.com/niceplugin/zero-admin/pull/3729)
-   Add optional `LayoutChangeContext` to `onChange` callback with `source: 'commit' | 'direct'` to distinguish edit-mode commits from direct widget changes. [#3561]([upstream private reference omitted])

## 0.12.0 (2026-03-04)

### Enhancements

-   Add `columnsNumber` prop to Dashboard for fixed column layouts, bypassing responsive behavior. Mutually exclusive with `minColumnWidth`. [#3515](https://github.com/niceplugin/zero-admin/pull/3515)

## 0.11.0 (2026-02-25)

### Enhancements

-   Add `onRemove` callback to `WidgetRenderProps`, allowing widgets to remove themselves from the dashboard. Uses `onSyncLayout` for immediate persistence without requiring edit mode. [#3267](https://github.com/niceplugin/zero-admin/pull/3267)

### Code Quality

-   Rename internal `layout` variable to `widgetLayout` in `SingleDashboardWidget` to avoid shadowing the context `layout`.

## 0.10.0 (2026-02-19)

### Enhancements

-   Add `resolveWidgetTypes()` utility for async widget module loading via dynamic `import()`. Validates default exports, merges with PHP registration data (PHP wins on `name` and `render_module`), and filters out failures gracefully. [#2782](https://github.com/niceplugin/zero-admin/pull/2782)
-   Add `useWidgetTypes` hook that wraps `resolveWidgetTypes` with React lifecycle (state, `AbortController` cleanup).
-   Add `RegisteredDashboardWidgetType` interface for the PHP registration contract.
-   Export `resolveWidgetTypes` and `useWidgetTypes` from the package public API.

## 0.9.0 (2026-02-12)

### Enhancements

-   Add `minColumnWidth` prop (default: 350) for responsive column count based on available width. [#2754](https://github.com/niceplugin/zero-admin/pull/2754)
-   Add `collapseWidth` prop (default: 640) to force single-column layout below a breakpoint.
-   Add `onWidgetError` callback to `DashboardProps` for parent-level error state tracking.

### Bug Fixes

-   Fix WPDS design token names (`--wpds-border-radius-medium` to `--wpds-border-radius-surface-md`, etc.).

### Code Quality

-   Refactor grid layout logic to use `ResizeObserver` for container-based responsive behavior.
-   Remove JSDoc boilerplate from all component files.

## 0.8.0 (2026-02-05)

### Breaking Changes

-   Remove `WidgetLoadingState` component. Use `WidgetLoadingOverlay` instead. [#2639](https://github.com/niceplugin/zero-admin/pull/2639)

### Enhancements

-   Add `WidgetLoadingOverlay` component with absolute positioning and CSS-based spinner. Exported from package public API.
-   Add `minColumnWidth` support to `DashboardWidgetsGrid` for dynamic column calculation. [#2717](https://github.com/niceplugin/zero-admin/pull/2717)

## 0.7.0 (2026-01-28)

### Enhancements

-   Add `defaults` property to `DashboardWidgetType` for initial grid placement (`width`, `height`, `order`). Used by `createDashboardWidget` factory when inserting widgets. [#2562](https://github.com/niceplugin/zero-admin/pull/2562)
-   Add `WidgetLoadingState` spinner component for consistent widget loading indicators. [#2568](https://github.com/niceplugin/zero-admin/pull/2568)

### Bug Fixes

-   Fix dashboard widget card styling to match admin Card component (border, border-radius, background). [#2539](https://github.com/niceplugin/zero-admin/pull/2539)
-   Reduce dashboard widget title font size from `--wpds-font-size-lg` to heading MD.

### Code Quality

-   Use `color-mix()` with CSS token for widget border color.

## 0.6.0 (2026-01-21)

### Enhancements

-   Update dashboard to 3-column default grid layout. [#2439](https://github.com/niceplugin/zero-admin/pull/2439)

## 0.5.0 (2026-01-14)

### Enhancements

-   Add widget error state support with `setError` callback in `WidgetRenderProps` and `WidgetErrorBoundary` component. Supports `setError( true )` for default error message, custom `WidgetErrorConfig` objects with message/icon/action, and `null` to clear. [#2316](https://github.com/niceplugin/zero-admin/pull/2316)
-   Add `WidgetError` component with customizable message, icon, and retry action button.
-   Add `scrollableContent` layout option. When enabled, a gradient fade overlay appears at the bottom of the widget content area.
-   Add dynamic menu support for dashboard widgets.
-   Export `WidgetErrorConfig` type from public API.

### Bug Fixes

-   Fix CSS variable names in `widget-error/style.scss` and notices (`--wpds-font-size-medium` to `--wpds-font-size-md`). [#2375](https://github.com/niceplugin/zero-admin/pull/2375)
-   Wrap `onError` callback in try-catch to prevent cascade failures in error boundary.

### Code Quality

-   Change widget content area from `height: 100%` to `flex: 1` with `min-height: 0` for proper flex shrinking.

### Internal

-   Update `@wordpress/theme` to 0.5.1. [#2314](https://github.com/niceplugin/zero-admin/pull/2314)

## 0.4.0 (2025-12-22)

### Enhancements

-   Add `icon` property to `DashboardWidgetType` for displaying an icon before widget titles. Uses Design System `Icon` component. [#2268](https://github.com/niceplugin/zero-admin/pull/2268)
-   Include `icon` in header visibility check (header shows when any of `title`, `icon`, `info`, or `description` are present).
-   Add JSDoc documentation to all `DashboardWidgetType` fields.

### Bug Fixes

-   Remove `gap` between widget header and content (was `gap={ 4 }`). [#2255](https://github.com/niceplugin/zero-admin/pull/2255)

### Code Quality

-   Replace `any` with `unknown` in `SingleDashboardWidget` props and type-guard pattern in `DashboardWidgetSettings`.

## 0.3.0 (2025-12-18)

### Enhancements

-   Add `DashboardNotices` compound sub-component (`Dashboard.Notices`). Renders notices via Dashboard context with status-based styling (`error`, `warning`, `info`, `success`), priority ordering, and action buttons. [#2138](https://github.com/niceplugin/zero-admin/pull/2138)
-   Add `notices` and `onNoticeAction` props to `DashboardProps`.
-   Add `DashboardNoticeType`, `DashboardNoticeAction`, and `DashboardNoticeProps` types.

### Bug Fixes

-   Fix TypeScript strict mode errors in `DashboardWidgetSettings` (generic type parameter, `useCallback` deps).
-   Update settings modal title format from `"Settings: %s"` to `"%s settings"`. [#2220](https://github.com/niceplugin/zero-admin/pull/2220)

### Code Quality

-   Replace `any` with `unknown` throughout context and Dashboard component.
-   Infer `NoticeStatus` type from WordPress `Notice` component props.
-   Remove `DashboardWidgetBadge` from public exports (internal only).

### Documentation

-   Add comprehensive Dashboard Notices documentation (`src/components/dashboard-notices/README.md`).

## 0.2.0 (2025-12-11)

### Bug Fixes

-   Fix widget search in picker to match all words in widget name (use `replace( /[\/,-_]/g, ' ' )` instead of `split( '/' )`). [#2173](https://github.com/niceplugin/zero-admin/pull/2173)

## 0.1.0 (2025-12-10)

Initial tracked release of `@zero-admin/dashboard`.

### Enhancements

-   Compound component pattern: `Dashboard`, `Dashboard.Actions`, `Dashboard.Widgets`.
-   Widget grid layout with drag-and-drop support via `@automattic/grid`.
-   Widget type resolution from PHP registrations.
-   Widget attributes system with settings modal and `DataForm` integration.
-   Widget badge system with intent-based styling (`high`, `medium`, `low`, `stable`, `informational`, `draft`).
-   Widget picker with `DataViews` list for inserting new widgets.
-   `WidgetRender` component with lazy loading via `React.lazy` and `Suspense`.
-   `createDashboardWidget` factory function for widget instance creation.

### Internal

-   Move package to `wordpress/plugins/` directory structure. [#2150](https://github.com/niceplugin/zero-admin/pull/2150)
