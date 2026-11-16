# Dashboard Notices

A system for displaying informational messages at the top of the dashboard. Notices can be dynamically registered by plugins, react to data changes, and include action buttons—all without page reloads.

## Quick Start

```typescript
import { registerDashboardNotice } from '@zero-admin/boot';
import { executeAbility } from '@wordpress/abilities';
import { __ } from '@wordpress/i18n';

export function init() {
	registerDashboardNotice( {
		id: 'my-plugin-setup',
		status: 'warning',
		message: __( 'Complete setup to start using My Plugin.', 'my-plugin' ),
		actions: [
			{
				id: 'start-setup',
				label: __( 'Start Setup', 'my-plugin' ),
				onClick: () =>
					executeAbility( 'zero-admin/navigate', {
						path: '/my-plugin/setup',
					} ),
			},
		],
	} );
}
```

## Core Concepts

### Notice Configuration

Notices are defined with the following properties:

```typescript
interface DashboardNoticeConfig {
	id: string; // Unique identifier
	status: 'error' | 'warning' | 'info' | 'success'; // Visual styling
	message: string; // Notice text
	priority?: number; // Display order (higher = first, default: 0)
	shouldShow?: () => boolean; // Dynamic visibility
	dataDependencies?: EntityDependency[]; // Data subscriptions
	actions?: Array< {
		id: string; // Required: Unique action identifier
		label: string;
		onClick: () => void;
	} >;
}
```

**Status types:**

-   `'error'` - Critical issues requiring immediate action (red)
-   `'warning'` - Important issues that should be addressed (orange)
-   `'info'` - Helpful information (blue)
-   `'success'` - Confirmation messages (green)

**Priority ordering:**

-   Critical errors: 100+
-   Warnings: 50-99
-   Info: 0-49

### Reactive Notices

Notices can dynamically show/hide based on data state using the `shouldShow` function combined with `dataDependencies`:

```typescript
registerDashboardNotice( {
	id: 'setup-incomplete',
	status: 'warning',
	message: __( 'Setup is not complete.', 'my-plugin' ),
	shouldShow: () => {
		const settings = select( coreDataStore ).getEntityRecord(
			'root',
			'settings',
			'my-plugin'
		);
		// Show while loading or if setup incomplete
		return ! settings || ! settings.setup_complete;
	},
	// Declare what data this notice depends on
	dataDependencies: [ { kind: 'root', name: 'settings', id: 'my-plugin' } ],
} );
```

**Data Dependencies:**

-   `dataDependencies` tells the dashboard what entity records to subscribe to
-   The dashboard automatically subscribes to these records, triggering re-renders when data loads/changes
-   This ensures `shouldShow` is re-evaluated when your data changes
-   **Always declare dependencies** when using data in `shouldShow`

**Important:** The `shouldShow` function is evaluated on each render. Keep it lightweight and read from already-loaded data sources.

## Creating Dashboard Notices

### Step 1: Create an Init Module

Init modules run at application startup, making them ideal for notice registration.

**Directory structure:**

```text
plugins/your-plugin-next/
└── packages/
    └── init/
        ├── package.json
        └── src/
            └── index.ts
```

**package.json:**

```json
{
	"name": "@your-plugin-next/init",
	"version": "1.0.0",
	"type": "module",
	"wpModule": true,
	"initModule": true,
	"exports": {
		".": "./src/index.ts"
	},
	"dependencies": {
		"@zero-admin/boot": "workspace:*",
		"@wordpress/abilities": "next",
		"@wordpress/i18n": "next"
	}
}
```

Required flags:

-   `"wpModule": true` - Marks as a WordPress module
-   `"initModule": true` - Auto-runs at startup

### Step 2: Register the Notice

**src/index.ts:**

```typescript
import { registerDashboardNotice } from '@zero-admin/boot';
import { executeAbility } from '@wordpress/abilities';
import { __ } from '@wordpress/i18n';

export function init() {
	registerDashboardNotice( {
		id: 'my-plugin-notice',
		status: 'warning',
		message: __( 'Action required: Configure My Plugin.', 'my-plugin' ),
		priority: 75,
		actions: [
			{
				id: 'configure-now',
				label: __( 'Configure Now', 'my-plugin' ),
				onClick: () =>
					executeAbility( 'zero-admin/navigate', {
						path: '/my-plugin/settings',
					} ),
			},
		],
	} );
}
```

### Step 3: Ensure Workspace Configuration

Verify your plugin is included in `pnpm-workspace.yaml`:

```yaml
packages:
    - 'plugins/your-plugin-next/packages/*'
```

### Step 4: Build

The init module is automatically discovered and built:

```bash
npm run build    # Production
npm run dev      # Development with watch
```

## API Reference

### `registerDashboardNotice(config)`

Registers a new dashboard notice. If a notice with the same `id` exists, it replaces it.

**Parameters:**

```typescript
{
  id: string;                    // Required: Unique identifier
  status: 'error' | 'warning' | 'info' | 'success';  // Required
  message: string;               // Required: Notice text
  priority?: number;             // Optional: Default 0
  shouldShow?: () => boolean;    // Optional: Dynamic visibility
  dataDependencies?: Array<{     // Optional: Data subscriptions
    kind: string;                //   Entity kind (e.g., 'root')
    name: string;                //   Entity name (e.g., 'settings')
    id: string | number;         //   Entity ID
  }>;
  actions?: Array<{              // Optional: Action buttons
    id: string;                  //   Required: Unique action identifier
    label: string;
    onClick: () => void;
  }>;
}
```

### `unregisterDashboardNotice(id)`

Removes a notice from the dashboard.

```typescript
import { unregisterDashboardNotice } from '@zero-admin/boot';

unregisterDashboardNotice( 'my-plugin-notice' );
```

### `updateDashboardNotice(id, changes)`

Updates properties of an existing notice.

```typescript
import { updateDashboardNotice } from '@zero-admin/boot';

updateDashboardNotice( 'my-plugin-notice', {
	status: 'success',
	message: __( 'Setup complete!', 'my-plugin' ),
} );
```

### Navigation from Notices

To navigate from notice action buttons, use the `zero-admin/navigate` ability:

```typescript
import { executeAbility } from '@wordpress/abilities';

// Simple navigation
onClick: () =>
	executeAbility( 'zero-admin/navigate', {
		path: '/my-plugin/settings',
	} );

// With query parameters
onClick: () =>
	executeAbility( 'zero-admin/navigate', {
		path: '/my-plugin/settings',
		search: { tab: 'advanced' },
	} );
```

## Complete Example: PayPal Plugin

Real-world implementation showing reactive notices with data dependencies:

```typescript
import { registerDashboardNotice } from '@zero-admin/boot';
import { executeAbility } from '@wordpress/abilities';
import { __ } from '@wordpress/i18n';
import { select } from '@wordpress/data';
import { store as coreDataStore } from '@wordpress/core-data';

function isPayPalConnected(): boolean {
	const record = select( coreDataStore ).getEntityRecord(
		'root',
		'settings',
		'paypal'
	);

	// Assume not connected while loading
	if ( ! record?.data?.advanced ) {
		return false;
	}

	const connectionCard = record.data.advanced.find(
		( card ) => card.id === 'paypal_advanced_connection_status'
	);
	const connectionStatus = connectionCard?.settings?.find(
		( setting ) => setting.id === 'connection_status'
	);

	return connectionStatus?.value?.isConnected === true;
}

export function init() {
	registerDashboardNotice( {
		id: 'paypal-disconnected',
		status: 'warning',
		message: __(
			'Your PayPal account is not connected. To accept payments on your store, connect PayPal Payments.',
			'woocommerce-paypal-payments'
		),
		priority: 100,
		shouldShow: () => ! isPayPalConnected(),
		dataDependencies: [ { kind: 'root', name: 'settings', id: 'paypal' } ],
		actions: [
			{
				id: 'connect-paypal',
				label: __(
					'Connect PayPal Payments',
					'woocommerce-paypal-payments'
				),
				onClick: () =>
					executeAbility( 'zero-admin/navigate', {
						path: '/woocommerce/settings/payments/paypal',
					} ),
			},
		],
	} );
}
```

**Key patterns:**

-   Data check function returns `false` while loading (shows notice)
-   Dashboard subscribes to PayPal settings for reactive updates
-   High priority ensures visibility for critical payment setup

## Data Dependencies

When your notice's `shouldShow` function depends on entity data, **always declare `dataDependencies`**. The dashboard automatically subscribes to these dependencies, ensuring your notice updates when the data changes.

**Example:**

```typescript
registerDashboardNotice( {
	id: 'wc-orders-pending',
	message: __( 'You have pending orders to process.', 'my-plugin' ),
	shouldShow: () => {
		const orders = select( store ).getOrders( { status: 'pending' } );
		return orders?.length > 0;
	},
	// Declare the entity records this notice reads from
	dataDependencies: [ { kind: 'postType', name: 'shop_order', id: 'all' } ],
} );
```

**Why it matters:**

-   Without `dataDependencies`, your notice won't update when data loads
-   The dashboard needs to know what data to subscribe to
-   This makes dependencies explicit and prevents stale UI

## Best Practices

1. **Use unique IDs**: Prefix with plugin name to avoid conflicts

    ```typescript
    id: 'my-plugin-setup-incomplete';
    ```

2. **Appropriate priorities**: Use the priority scale consistently

    - Critical errors: 100+
    - Warnings: 50-99
    - Info: 0-49

3. **Lightweight `shouldShow`**: Keep functions fast, read from loaded data

    ```typescript
    // Good - reads from store
    shouldShow: () => select(store).getData()?.needsAttention

    // Bad - triggers async operations
    shouldShow: () => fetch('/api/check').then(...)
    ```

4. **Handle loading states**: Assume problem exists while data loads

    ```typescript
    shouldShow: () => {
    	const data = select( store ).getData();
    	if ( ! data ) {
    		return true; // Show notice while loading
    	}
    	return ! data.isConfigured;
    };
    ```

5. **Clear action labels**: Use action verbs that describe what happens

    ```typescript
    // Good
    label: __( 'Connect PayPal', 'my-plugin' );

    // Less clear
    label: __( 'Click Here', 'my-plugin' );
    ```

6. **Use proper status levels**: Match severity to status type

    ```typescript
    // Payment processor disconnected = warning (not error)
    status: 'warning';

    // Database connection failed = error
    status: 'error';

    // Setup wizard available = info
    status: 'info';
    ```

7. **Correct text domains**: Always use your plugin's text domain

    ```typescript
    message: __( 'Message text', 'my-plugin' ); // Correct
    message: __( 'Message text', 'zero-admin' ); // Wrong
    ```

## Troubleshooting

**Notice doesn't appear:**

-   Check browser console for errors
-   Verify init module has `"wpModule": true` and `"initModule": true`
-   Run `pnpm install` to register new packages
-   Confirm build completed successfully
-   Check `shouldShow()` returns `true`

**Notice doesn't update when data changes:**

-   Ensure `shouldShow()` reads from reactive data sources (Redux stores)
-   Add data subscription to dashboard route (see Data Subscriptions section)
-   Avoid caching `shouldShow()` results

**Action button doesn't navigate:**

-   Use `executeAbility('zero-admin/navigate', { path: '...' })`
-   Import `executeAbility` from `@wordpress/abilities`
-   Check console for navigation errors
-   Verify route path is correct

**Notice shows briefly then disappears:**

-   Check `shouldShow()` logic during loading state
-   Ensure data subscription is in place
-   Verify data is being loaded correctly
