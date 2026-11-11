# @first-admin/wp-build

Opinionated build tooling for WordPress plugins with routes and packages support.

## Installation

```bash
npm install @first-admin/wp-build
```

## Usage

### CLI Commands

#### Build for Production

```bash
wp-build build
```

#### Development Mode (with watch)

```bash
wp-build dev
```

### CLI Options

#### Generate metadata

Generate a `meta.json` file for bundle analysis, when building.

```bash
wp-build --meta build
```

#### Aggregate metadata to a single file

If you prefer a single metafile at the root of your build, you can request `wp-build` to merge all per-target `meta.json` files and write one combined file. This is useful for tools that expect a single input.

```bash
wp-build --meta --meta-out build/meta.json build
```

Notes:

-   `--meta` still writes per-target `meta.json` files (e.g. under `build/routes/<routeName>/<outputFile>.meta.json` and `build/<moduleName>/<outputFile>.meta.json`).
-   When `--meta-out` is provided, `wp-build` scans `build/` for those metafiles and writes a merged JSON to the specified path.
-   The merged file is a simple merge of `inputs` and `outputs` maps from all metafiles.

### Project Structure

Your WordPress plugin should follow this structure:

```text
your-plugin/
├── routes/                    # Route components
│   ├── dashboard/
│   │   ├── package.json      # Route configuration
│   │   ├── stage.tsx         # Route stage component
│   │   ├── inspector.tsx     # Route inspector component (optional)
│   │   └── route.tsx         # Route configuration (optional)
│   └── settings/
│       ├── package.json
│       └── stage.tsx
├── packages/                  # WP Modules
│   ├── my-module/
│   │   ├── package.json      # Must have "wpModule": true
│   │   └── src/
│   │       └── index.ts      # Module entry point
│   └── another-module/
│       ├── package.json
│       └── src/
│           └── index.tsx
├── build/                     # Generated build output
│   ├── index.php             # Auto-generated PHP entry point
│   ├── routes/               # Built routes
│   └── [module-name]/        # Built WP modules
└── your-plugin.php           # Main plugin file
```

### Route Configuration

Each route needs a `package.json` with route configuration:

```json
{
	"name": "dashboard-route",
	"route": {
		"path": "/dashboard"
	}
}
```

Routes can have:

-   `stage.tsx` - Stage surface component (optional)
-   `inspector.tsx` - Inspector surface component (optional)
-   `route.tsx` - Route configuration component (optional)

### WP Module Configuration

Each WP module needs a `package.json` with `wpModule: true`:

```json
{
	"name": "@your-plugin/my-module",
	"wpModule": true
}
```

### PHP Integration

Simply include the generated PHP entry point in your main plugin file:

```php
<?php
// Include the auto-generated build index
require_once plugin_dir_path( __FILE__ ) . 'build/index.php';
```

The build tool automatically:

-   Registers all WP modules as script modules
-   Registers all route components
-   Handles dependencies and asset loading
-   Calls your existing route registration function

## Features

-   **First Config**: Works out of the box with sensible defaults
-   **TypeScript/JSX Support**: Full TypeScript and JSX compilation
-   **Sass/SCSS Support**: Including CSS modules
-   **WordPress Externals**: Automatic externalization of WordPress packages
-   **Auto-generated PHP**: No manual registration code needed
-   **Route Discovery**: Automatic route and module discovery
-   **Development Mode**: Watch mode with hot reloading
-   **Parallel Builds**: Utilizes all CPU cores for fast builds
-   **Metadata Generation**: Optionally generate metadata for bundle analysis

## Configuration

The build tool uses your project's:

-   `browserslist` configuration for browser targets
-   `tsconfig.json` for TypeScript settings

## Package.json Scripts

Add these scripts to your `package.json`:

```json
{
	"scripts": {
		"build": "wp-build build",
		"build:meta": "wp-build --meta build",
		"dev": "wp-build dev"
	}
}
```
