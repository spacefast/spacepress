import type { SchemaDescription } from './types';

export interface MenuEntry {
	id: string;
	to: string;
	label: string;
	kind: 'overview' | 'collection' | 'media' | 'global' | 'classic';
}

/**
 * What the page decided the viewer may read, per collection and global, with the runtime's own
 * access evaluation (`CoreAccess::mayRead`). The admin never re-derives it from summaries.
 */
export interface Permits {
	collections: Record< string, boolean >;
	globals: Record< string, boolean >;
}

/**
 * The sidebar: the overview, one entry per collection the viewer's read rule may allow anything
 * for, Media, one entry per readable global, and the classic admin. A collection whose rule denies
 * outright has no entry; a filtered or per-row rule gets one, and its list may then be empty.
 * The schema itself stays public; this only decides navigation.
 */
export function menuOf( schema: SchemaDescription, permits: Permits ): MenuEntry[] {
	const entries: MenuEntry[] = [ { id: 'zero-overview', to: '/', label: 'Collections', kind: 'overview' } ];
	for ( const [ name, collection ] of Object.entries( schema.collections ) ) {
		if ( collection.api.list === false || ! permits.collections[ name ] ) {
			continue;
		}
		entries.push( { id: `zero-collection-${ name }`, to: `/collections/${ name }`, label: collection.label, kind: 'collection' } );
	}
	entries.push( { id: 'zero-media', to: '/media', label: 'Media', kind: 'media' } );
	for ( const [ name, global ] of Object.entries( schema.globals ) ) {
		if ( ! permits.globals[ name ] ) {
			continue;
		}
		entries.push( { id: `zero-global-${ name }`, to: `/globals/${ name }`, label: global.label, kind: 'global' } );
	}
	entries.push( { id: 'zero-classic', to: '/legacy/index.php', label: 'Classic admin', kind: 'classic' } );
	return entries;
}

/** The collections the overview tiles show: the same test as the menu. */
export function readableCollections( schema: SchemaDescription, permits: Permits ): string[] {
	return menuOf( schema, permits )
		.filter( ( entry ) => entry.kind === 'collection' )
		.map( ( entry ) => entry.id.slice( 'zero-collection-'.length ) );
}
