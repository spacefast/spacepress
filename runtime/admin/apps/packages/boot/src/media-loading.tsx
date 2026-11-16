import { Button, Notice, Spinner } from '@wordpress/components';
import type { useMediaResource } from './use-media-url';
import './media-loading.scss';

export function MediaLoading({ resource }: { resource: ReturnType<typeof useMediaResource> }) {
	if (resource.kind === 'error')
		return (
			<Notice status="error" isDismissible={false}>
				{resource.message}{' '}
				<Button variant="secondary" onClick={resource.retry}>
					Retry media
				</Button>
			</Notice>
		);
	return (
		<div className="typedpress-admin-media-loading">
			<Spinner />
		</div>
	);
}
