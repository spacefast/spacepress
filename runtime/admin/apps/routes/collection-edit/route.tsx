import { resolveSelect, dispatch, select } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { store as editorStore } from '@wordpress/editor';
import { unlock } from '@zero-admin/admin-toolkit';
import { store as bootStore } from '@zero-admin/boot';
import { contextOf } from '@zero-admin/zero-client';

function collectionOf( name: string ) {
	const context = contextOf( select( bootStore ).getDashboardContext() as Record< string, unknown > );
	return context.schema?.collections[ name ] ?? null;
}

/**
 * A content collection's row opens in the block editor: the canvas is core's editor on the post,
 * saving through core `/wp/v2/zero_<table>` like the editor does, with the "Fields" panel (the
 * row form) in its sidebar. A collection without `content` has no canvas; the stage form is all.
 */
export const route = {
	canvas: async ( { params }: { params: { collection: string; id: string } } ) => {
		const collection = collectionOf( params.collection );
		if ( ! collection?.wp || ! collection.content ) {
			return undefined;
		}
		const postType = collection.wp.postType;
		try {
			const typeObject = await resolveSelect( coreStore ).getPostType( postType );
			if ( ! typeObject ) {
				return undefined;
			}
			const { registerPostTypeSchema } = unlock( dispatch( editorStore ) ) as { registerPostTypeSchema: ( type: string ) => Promise< void > };
			await registerPostTypeSchema( postType );
		} catch {
			return undefined;
		}
		return {
			postType,
			postId: params.id,
			editLink: `/collections/${ encodeURIComponent( params.collection ) }/${ encodeURIComponent( params.id ) }`,
			size: 'compact' as const,
		};
	},
};
