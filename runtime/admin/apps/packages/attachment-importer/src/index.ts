import apiFetch from '@wordpress/api-fetch';
import { store as coreStore } from '@wordpress/core-data';
import { store as noticesStore } from '@wordpress/notices';
import type { useRegistry } from '@wordpress/data';
import type { RestAttachment } from '@wordpress/media-utils';

/** Upload under First's rules, then read the native representation Gutenberg expects. */
export async function uploadAttachment(file: File): Promise<RestAttachment> {
	const body = new FormData();
	body.append('file', file);
	const result: unknown = await apiFetch({
		path: '/first/v1/media',
		method: 'POST',
		body,
	});
	if (
		!result ||
		typeof result !== 'object' ||
		!('data' in result) ||
		!result.data ||
		typeof result.data !== 'object' ||
		!('id' in result.data) ||
		typeof result.data.id !== 'number'
	)
		throw new Error('The upload returned no media identity.');
	return apiFetch({ path: `/wp/v2/media/${result.data.id}?context=edit` });
}
export default async function importAttachment(
	registry: ReturnType<typeof useRegistry>,
	input: string | File[]
): Promise<void> {
	const notices = registry.dispatch(noticesStore);
	if (typeof input === 'string') {
		notices.createErrorNotice('Please drop media files only.', {
			type: 'snackbar',
		});
		return;
	}
	try {
		for (const file of input) {
			notices.createInfoNotice(`Uploading ${file.name}…`, {
				type: 'snackbar',
				id: 'media-upload-notice',
			});
			const media = await uploadAttachment(file);
			registry
				.dispatch(coreStore)
				.receiveEntityRecords(
					'postType',
					'attachment',
					[media],
					undefined,
					true
				);
		}
		notices.createSuccessNotice('Media uploaded.', {
			type: 'snackbar',
			id: 'media-upload-notice',
		});
	} catch (e: unknown) {
		const message =
			e instanceof Error
				? e.message
				: e &&
					  typeof e === 'object' &&
					  'message' in e &&
					  typeof e.message === 'string'
					? e.message
					: 'Upload failed.';
		notices.createErrorNotice(message, {
			type: 'snackbar',
			id: 'media-upload-notice',
		});
	}
}
