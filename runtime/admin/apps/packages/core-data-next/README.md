# @spacepress-admin/core-data-next

Extended core data functionality for SpacePress Admin, providing access to field collections via the WordPress REST API.

Ideally, this package shouldn't exist and its functionality should be merged into `@wordpress/core-data`. However, due to the experimental nature of some of the features (like field collections), it's currently maintained as a separate package until later core merge.

## Installation

> [!NOTE]
> Currently, this package is intended for use within the SpacePress Admin plugin context. You do not need to install it from the public NPM registry. Instead, import it directly as a workspace dependency in spacepress-admin and it will be consumed as a module in WordPress.

To use this package in your workspace, add it to your `package.json` dependencies:

```json
{
	"dependencies": {
		"@spacepress-admin/core-data-next": "workspace:*"
	}
}
```

## Usage

### Basic Selector Usage

Use the `getEntityFieldCollections` selector with `useSelect` to retrieve field collections for a specific entity:

```tsx
import { useSelect } from '@wordpress/data';

function MyFieldCollectionsComponent() {
	const fieldCollections = useSelect( ( select ) => {
		const { getEntityFieldCollections } = select( 'core-data-next' );
		return getEntityFieldCollections( 'postType', 'attachment' );
	}, [] );

	if ( ! fieldCollections || fieldCollections.length === 0 ) {
		return <div>No field collections available</div>;
	}

	return (
		<div>
			{ fieldCollections.map( ( collection ) => (
				<div key={ collection.id }>
					<h3>{ collection.id }</h3>
					<p>Fields: { Object.keys( collection.fields ).length }</p>
				</div>
			) ) }
		</div>
	);
}
```
