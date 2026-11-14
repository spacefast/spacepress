import { dispatch, select } from '@wordpress/data';
import { store as preferencesStore } from '@wordpress/preferences';
import { act, renderHook } from '@testing-library/react';
import { loadView, useView } from '../index';

// What a list asks for: a tab's default view, whose filters are the tab.
const roleTab = {
	kind: 'root',
	name: 'user',
	slug: 'editor',
	defaultView: {
		type: 'table' as const,
		fields: [ 'email' ],
		filters: [ { field: 'roles', operator: 'is' as const, value: 'editor' } ],
	},
};

describe( 'First Admin views on @wordpress/views', () => {
	afterEach( () => {
		void dispatch( preferencesStore ).set( 'core/views', 'dataviews-root-user-editor', undefined );
	} );

	it( "keeps the tab's filters on top of a saved view that changed them", async () => {
		void dispatch( preferencesStore ).set( 'core/views', 'dataviews-root-user-editor', {
			fields: [ 'email', 'posts' ],
			filters: [ { field: 'roles', operator: 'is', value: 'subscriber' } ],
		} );
		const view = await loadView( roleTab );
		expect( view.fields ).toEqual( [ 'email', 'posts' ] );
		expect( view.filters ).toEqual( [
			{ field: 'roles', operator: 'is', value: 'editor', isLocked: true },
		] );
	} );

	it( "saves a user's change under the @wordpress/views key, without the tab's filters", () => {
		const { result, unmount } = renderHook( () => useView( roleTab ) );
		act( () => result.current.updateView( { ...result.current.view, fields: [ 'email', 'roles' ] } ) );
		const saved = select( preferencesStore ).get( 'core/views', 'dataviews-root-user-editor' ) as { fields?: string[]; filters?: unknown[] };
		expect( saved.fields ).toEqual( [ 'email', 'roles' ] );
		expect( saved.filters ?? [] ).toEqual( [] );
		unmount();
	} );
} );
