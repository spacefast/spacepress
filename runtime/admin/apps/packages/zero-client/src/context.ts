import { useSelect } from '@wordpress/data';
import { useMemo } from '@wordpress/element';
import { store as bootStore } from '@zero-admin/boot';
import { UTC, type Permits, type SchemaDescription, type SiteTime, type ViewerSummary } from '@zero-admin/schema';

/** What the page handed the app at boot: the schema, the viewer's permits, and who the viewer is. */
export interface ZeroContext {
	schema: SchemaDescription | null;
	permits: Permits;
	viewer: ViewerSummary;
	/** The site's timezone, for the site-time values SCF carries on core REST. */
	siteTime: SiteTime;
}

/** The description keys collections by name; each entry learns its own name so routes can be built from it alone. */
export function withNames( schema: SchemaDescription ): SchemaDescription {
	const collections: SchemaDescription[ 'collections' ] = {};
	for ( const [ name, collection ] of Object.entries( schema.collections ?? {} ) ) {
		collections[ name ] = { ...collection, name };
	}
	return { ...schema, collections };
}

const EMPTY: ZeroContext = { schema: null, permits: { collections: {}, globals: {} }, viewer: { id: null, role: null }, siteTime: UTC };

export function contextOf( context: Record< string, unknown > | undefined ): ZeroContext {
	if ( ! context ) {
		return EMPTY;
	}
	const schema = context.schema && typeof context.schema === 'object' ? withNames( context.schema as SchemaDescription ) : null;
	const permits = context.permits && typeof context.permits === 'object' ? ( context.permits as Permits ) : EMPTY.permits;
	const viewer = context.viewer && typeof context.viewer === 'object' ? ( context.viewer as ViewerSummary ) : EMPTY.viewer;
	const st = context.site_time && typeof context.site_time === 'object' ? ( context.site_time as { timezone?: unknown; gmt_offset?: unknown } ) : {};
	return {
		schema,
		permits: { collections: permits.collections ?? {}, globals: permits.globals ?? {} },
		viewer: { id: typeof viewer.id === 'number' ? viewer.id : null, role: typeof viewer.role === 'string' ? viewer.role : null },
		siteTime: { timezone: typeof st.timezone === 'string' && st.timezone !== '' ? st.timezone : null, gmtOffset: typeof st.gmt_offset === 'number' ? st.gmt_offset : 0 },
	};
}

export function useZeroContext(): ZeroContext {
	const context = useSelect( ( select ) => select( bootStore ).getDashboardContext() as Record< string, unknown >, [] );
	// The store's context object is stable between boots; derive once per object so effects keyed on a
	// collection do not refetch on every render.
	return useMemo( () => contextOf( context ), [ context ] );
}

export function useCollection( name: string ) {
	const { schema } = useZeroContext();
	return schema?.collections[ name ] ?? null;
}
