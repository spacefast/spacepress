/**
 * NOTE: Do NOT add `declare module '@wordpress/data'` augmentations here.
 *
 * The user-data package resolves its own copy of @wordpress/data (even when
 * both are the same semver version), so TypeScript sees `typeof store` as
 * a different type from the host app's StoreDescriptor.  Any useDispatch /
 * select overload added here will shadow every other store's overload and
 * break typing across the entire codebase.
 *
 * Consumers should treat useDispatch( userDataStore ) as untyped and cast
 * locally where needed, or use the module-level select() / dispatch() with
 * inline type assertions.
 */
