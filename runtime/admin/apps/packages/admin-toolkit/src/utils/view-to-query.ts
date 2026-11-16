import type { View } from '@typedpress-admin/dataviews';

export default function viewToQuery( view: View, postType: string ) {
	const result: Record<
		string,
		string | number | string[] | number[] | boolean
	> = {};

	// Pagination, sorting, search.
	if ( undefined !== view.perPage ) {
		result.per_page = view.perPage;
	}

	if ( undefined !== view.page ) {
		result.page = view.page;
	}

	if ( view.search !== undefined && view.search !== '' ) {
		result.search = view.search;
	}

	if ( undefined !== view.sort?.field ) {
		let sortField = view.sort.field;

		if ( sortField === 'attached_to' ) {
			sortField = 'parent';
		}

		result.orderby = sortField;
	}

	if ( undefined !== view.sort?.direction ) {
		result.order = view.sort.direction;
	}

	if ( view.showLevels ) {
		result.orderby_hierarchy = true;
	}

	// Filters.
	// Filter values from @typedpress-admin/dataviews are typed as `any`.
	/* eslint-disable @typescript-eslint/no-unsafe-assignment */
	const status = view.filters?.find(
		( filter ) => filter.field === 'status'
	);
	if ( status ) {
		result.status = status.value;
	} else if ( postType === 'attachment' ) {
		result.status = 'inherit';
	} else {
		result.status = 'draft,future,pending,private,publish';
	}

	const author = view.filters?.find(
		( filter ) => filter.field === 'author'
	);
	if ( author && author.operator === 'is' ) {
		result.author = author.value;
	} else if ( author && author.operator === 'isNot' ) {
		result.author_exclude = author.value;
	}

	const commentStatus = view.filters?.find(
		( filter ) => filter.field === 'comment_status'
	);
	if ( commentStatus && commentStatus.operator === 'is' ) {
		result.comment_status = commentStatus.value;
	} else if ( commentStatus && commentStatus.operator === 'isNot' ) {
		result.comment_status_exclude = commentStatus.value;
	}

	const mediaType = view.filters?.find(
		( filter ) => filter.field === 'media_type'
	);

	if ( mediaType ) {
		result.media_type = mediaType.value;
	}
	/* eslint-enable @typescript-eslint/no-unsafe-assignment */

	// Embed author for all post types to display author name in list views.
	// For attachments, also embed the parent (attached to) post to get its title.
	if ( postType === 'attachment' ) {
		result._embed = 'author,wp:attached-to';
	} else {
		result._embed = 'author';
	}

	return result;
}
