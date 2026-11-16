import { resolveSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { redirect } from '@wordpress/route';

const TEMPLATE_PART_POST_TYPE = 'wp_template_part';

async function getHeaderTemplatePart(): Promise< { id: string } | null > {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- getEntityRecords returns any-typed value for unknown post types
	const parts = await resolveSelect( coreStore ).getEntityRecords(
		'postType',
		TEMPLATE_PART_POST_TYPE,
		{ area: 'header', per_page: 1 }
	);

	const part: unknown = parts?.[ 0 ];
	if (
		part &&
		typeof part === 'object' &&
		'id' in part &&
		typeof part.id === 'string'
	) {
		return { id: part.id };
	}
	return null;
}

export const route = {
	canvas: async () => {
		const part = await getHeaderTemplatePart();

		if ( ! part ) {
			return;
		}

		return {
			postType: TEMPLATE_PART_POST_TYPE,
			postId: part.id,
			isPreview: false,
		};
	},
	beforeLoad: async () => {
		const part = await getHeaderTemplatePart();

		if ( ! part ) {
			throw redirect( { to: '/design/navigation/list' } );
		}
	},
};
