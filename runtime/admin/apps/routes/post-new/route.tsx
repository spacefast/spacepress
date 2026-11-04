import { dispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

export const route = {
	canvas: async ( { params }: { params: { type: string } } ) => {
		const newPost = await dispatch( coreStore ).saveEntityRecord(
			'postType',
			params.type,
			{
				title: 'Auto Draft',
				content: '',
				status: 'auto-draft',
			}
		);

		return {
			postType: params.type,
			postId: String( newPost.id ),
		};
	},
};
