import clsx from 'clsx';
import { __ } from '@wordpress/i18n';
import { comment } from '@wordpress/icons';
import type { Field } from '@spacepress-admin/dataviews';
import type { Post } from '@wordpress/core-data';
import { Icon } from '@wordpress/ui';
import './style.scss';

const renderCommentsField = ( { item }: { item: Post } ) => {
	const commentCount = item.comment_count || 0;
	return (
		<div
			className={ clsx( 'comments-field', {
				'comments-field--no-comments': commentCount === 0,
			} ) }
		>
			<Icon
				key="comments-icon"
				icon={ comment }
				className="comments-field__icon"
			/>
			<span key="comments-count" className="comments-field__count">
				{ commentCount === 0
					? /* translators: Em dash displayed when there are no comments */
					  __( '—', 'spacepress-admin' )
					: commentCount }
			</span>
		</div>
	);
};

export const fieldExtensions: Partial< Field< Post > > = {
	render: renderCommentsField,
};
