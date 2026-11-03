import { useEntityRecord } from '@wordpress/core-data';
import { Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import type { MediaItem } from '../../types';
import MediaProvider from '../../provider';
import MediaEditorLayout from '../layout';

export default function MediaEditor({
	postType = 'attachment',
	postId,
	children,
	isPreview = false,
	editLink,
}: {
	postType?: string;
	postId: string;
	isPreview?: boolean;
	editLink?: string;
	children?: React.ReactNode;
}) {
	const { record, isResolving } = useEntityRecord<MediaItem>('postType', postType, postId);

	if (!isResolving && !record) {
		return (
			<Notice status="error" isDismissible={false}>
				{__(
					"You attempted to edit an item that doesn't exist. Perhaps it was deleted?",
					'zero-admin',
				)}
			</Notice>
		);
	}

	const resolvedEditLink = editLink ?? `/types/attachment/edit/${postId}`;

	return (
		<MediaProvider post={record as MediaItem}>
			<MediaEditorLayout isPreview={isPreview} editLink={resolvedEditLink} />
			{children}
		</MediaProvider>
	);
}
