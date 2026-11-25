# @spacepress-admin/dashboard

Dashboard system for CiabAdmin. Provides types and utilities for resolving
widget type registrations from PHP into hydrated definitions, and a React
component for rendering the dashboard UI with drag-and-drop layout management.

## Installation

> [!NOTE]
> This package is intended for use within an NPM workspaces context. Import
> it directly as a workspace dependency.

```json
{
	"dependencies": {
		"@spacepress-admin/dashboard": "workspace:*"
	}
}
```

## Quick Start

```tsx
import {
	Dashboard,
	useWidgetTypes,
	type DashboardWidget,
} from '@spacepress-admin/dashboard';

function MyDashboard( { registered } ) {
	const [ layout, setLayout ] = useState< DashboardWidget< unknown >[] >(
		[]
	);
	const widgetTypes = useWidgetTypes( registered );

	return (
		<Dashboard
			layout={ layout }
			onChange={ setLayout }
			widgetTypes={ widgetTypes }
		/>
	);
}
```

---

## Types

### `RegisteredDashboardWidgetType`

Shape of a widget type as registered by the PHP backend. Other packages
(like `@spacepress-admin/boot`) re-export it from here.

```ts
interface RegisteredDashboardWidgetType {
	name: string;
	render_module: string;
	widget_module: string;
}
```

### `DashboardWidgetType<Item>`

A fully-resolved widget type, ready for the UI.

```ts
interface DashboardWidgetType< Item > {
	name: string;
	title?: string;
	description?: string;
	info?: string;
	render_module: string;
	attributes?: Field< Item >[];
	example: Item;
	layout?: DashboardWidgetLayout;
	defaults?: DashboardLayoutWidgetDefaults;
}
```

### `DashboardWidget< Item >`

A widget instance in the user's layout.

| Property     | Type      | Description                                        |
| ------------ | --------- | -------------------------------------------------- |
| `uid`        | `string`  | Unique instance identifier (maps to grid `key`)    |
| `type`       | `string`  | Widget type name (e.g., `woocommerce/store-setup`) |
| `attributes` | `Item`    | User-configured widget attributes                  |
| `width`      | `number`  | Grid columns to span                               |
| `height`     | `number`  | Grid rows to span                                  |
| `order`      | `number`  | Display order (lower values first)                 |
| `fillWidth`  | `boolean` | Span remaining columns in the current row          |
| `fullWidth`  | `boolean` | Span all columns (`grid-column: 1 / -1`)           |

`fillWidth` and `fullWidth` are mutually exclusive — enforced at the type
level via a discriminated union that mirrors `@automattic/grid`'s
`GridLayoutItem`.

### `useWidgetTypes`

Hook that resolves `RegisteredDashboardWidgetType[]` into
`DashboardWidgetType[]`. Handles dynamic `import()`, default-export
validation, and merging with PHP registration data. **PHP fields win**
(`name`, `render_module` override module exports). Individual failures are
logged and filtered out — they never reject the promise.

```tsx
const registered = useSelect(
	( select ) => select( myStore ).getWidgetTypes(),
	[]
);
const widgetTypes = useWidgetTypes( registered );
```

---

## Dashboard Component

Renders the widget grid, editing controls, and notices.

### Props

| Prop             | Type                             | Default | Description                                          |
| ---------------- | -------------------------------- | ------- | ---------------------------------------------------- |
| `layout`         | `DashboardWidget[]`              | —       | Widget instances currently displayed                 |
| `onChange`       | `( layout, context? ) => void`   | —       | Callback when layout changes                         |
| `widgetTypes`    | `DashboardWidgetType[]`          | —       | Available widget types for insertion                 |
| `notices`        | `DashboardNoticeType[]`          | —       | Dashboard notices                                    |
| `onNoticeAction` | `( noticeId, actionId ) => void` | —       | Notice action callback                               |
| `onWidgetError`  | `( uid, error ) => void`         | —       | Widget error state callback                          |
| `columnsNumber`  | `number`                         | —       | Fixed column count (exclusive with `minColumnWidth`) |
| `minColumnWidth` | `number`                         | 350     | Minimum column width for responsive layout           |
| `rowHeight`      | `number \| 'auto'`               | 200     | Row height in pixels, or `'auto'` for content-sized  |
| `collapseWidth`  | `number`                         | 640     | Breakpoint for single-column layout                  |
| `children`       | `ReactNode`                      | —       | Custom dashboard layout                              |

The `onChange` callback receives an optional `context` argument with
`source: 'commit' | 'direct'` indicating whether the change came from edit
mode ("Done" button) or a direct widget action (e.g., self-removal). Not
fired when the user cancels edit mode.

### Sub-components

Override the default layout by providing children:

```tsx
<Dashboard layout={ layout } onChange={ setLayout }>
	<Dashboard.Actions />
	<Dashboard.Notices />
	<Dashboard.Widgets />
</Dashboard>
```

-   `<Dashboard.Actions />` — Edit/save buttons and widget inserter. Optional
    `onClick` prop fires before the state change with the action type
    (`'customize'`, `'done'`, `'cancel'`, `'add-widget'`).
-   `<Dashboard.Notices />` — Plugin-registered dashboard notices. See
    [notices docs](./src/components/dashboard-notices/README.md).
-   `<Dashboard.Widgets />` — Widget grid layout.

### Grid Behavior

-   **Wide (>= `collapseWidth`)**: Grid uses `minColumnWidth` to calculate
    responsive column count.
-   **Narrow (< `collapseWidth`)**: Grid forces 1 column.
-   **`rowHeight="auto"`**: Widgets size to their content instead of
    stretching to fill fixed-height rows.

---

## Widget Type Definition

### Layout Options

The `layout` property controls widget appearance:

-   **`contentPadding`** (default: `true`): Standard padding around widget
    content. Set to `false` for edge-to-edge.
-   **`scrollableContent`**: Enable scrollable content area with gradient
    fade overlay.

### Default Grid Placement

The `defaults` property defines initial dimensions when a widget is inserted:

-   **`width`**: Grid columns (default: 1)
-   **`height`**: Grid rows (default: 2)
-   **`order`**: Display order priority (default: 0)

### Header Visibility

The widget header is shown when **any** of `title`, `info`, or `description`
are present. If none are defined, the header is hidden and the widget has
full control over the display area.

### Badge Display

Widgets display a dynamic badge via `setBadge` from `WidgetRenderProps`:

```tsx
setBadge?.( tasks.length || null );
setBadge?.( { value: 3, intent: 'high' } );
setBadge?.( null );
```

Intent options: `'high'`, `'medium'`, `'low'`, `'stable'`, `'informational'`,
`'draft'`, `'none'`.

### Error State

Widgets report errors via `setError` from `WidgetRenderProps`:

```tsx
setError?.( true );
setError?.( {
	message: 'Unable to load sales data.',
	action: { label: 'Retry', onClick: () => refetch() },
} );
setError?.( null );
```

### Widget Attributes

Attributes use the `Field` type from `@spacepress-admin/dataviews`. Supported types:
`'text'`, `'integer'`, `'boolean'`, `'select'`, `'datetime'`.

---

## Creating Widgets

### Project Structure

Widgets must be placed in `dashboard-widgets/` for auto-discovery:

```text
your-project/
├── dashboard-widgets/
│   └── your-widget-name/
│       ├── package.json
│       ├── widget.ts
│       └── render.tsx
└── package.json
```

### Widget Definition (`widget.ts`)

```tsx
import type { DashboardWidgetType } from '@spacepress-admin/dashboard';
import { __ } from '@wordpress/i18n';

const widget: Omit<
	DashboardWidgetType< { maxItems: number } >,
	'render_module'
> = {
	name: 'my-plugin/my-widget',
	title: __( 'My Widget', 'my-plugin' ),
	example: { maxItems: 5 },
	defaults: { width: 2, height: 2 },
};

export default widget;
```

### Widget Render Component (`render.tsx`)

```tsx
import type { WidgetRenderProps } from '@spacepress-admin/dashboard';

export default function MyWidgetRender( {
	attributes,
}: WidgetRenderProps< { maxItems?: number } > ) {
	return <p>Showing { attributes?.maxItems ?? 5 } items</p>;
}
```

---

## Registering Widgets (PHP)

Widgets can be added via the `sp_admin_dashboard_widgets` filter:

```php
add_filter(
	'sp_admin_dashboard_widgets',
	function ( $layout ) {
		$uids = array_column( $layout, 'uid' );

		if ( ! in_array( 'my-widget-uid', $uids, true ) ) {
			$layout[] = array(
				'uid'   => 'my-widget-uid',
				'type'  => 'my-plugin/my-widget',
				'width' => 1,
				'height' => 2,
			);
		}

		return $layout;
	}
);
```

Parameters: `uid` (required), `type` (required), `attributes`, `width`,
`height`, `order`, `fillWidth`, `fullWidth`.

---

## Build System

Widgets are automatically discovered and built by `@spacepress-admin/wp-build`.
Output lands in `build/dashboard-widgets/`.

---

## Widget Context

The `useDashboardWidgetContext` hook gives render components access to their
identity: `uid`, `name`, and `position` in the dashboard grid. Returns `null`
outside a widget context.

```tsx
import { useDashboardWidgetContext } from '@spacepress-admin/dashboard';

export default function MyWidget() {
	const ctx = useDashboardWidgetContext();
	// { uid: 'abc-123', name: 'my-plugin/widget', position: 0 }
}
```

> `useWidgetContext` is deprecated — use `useDashboardWidgetContext` instead.

## Widget Lifecycle Actions

The dashboard emits `dashboard.widgetRendered` via `@wordpress/hooks` when a
widget's render module mounts. Subscribe at boot time to capture all widget
renders:

```tsx
import { addAction } from '@wordpress/hooks';

addAction( 'dashboard.widgetRendered', 'my-plugin/telemetry', ( ctx ) => {
	recordTracksEvent( 'widget_view', {
		widget_name: ctx.name,
	} );
} );
```

---

## Best Practices

1. Use `plugin-name/widget-name` naming convention
2. Always use `@wordpress/i18n` for user-facing strings
3. Provide sensible defaults in the `example` object
4. Place widgets in `dashboard-widgets/` for auto-discovery
5. Check for existing UIDs before adding widgets via PHP
