import { useCallback } from 'react';

type MediaState =
	| { kind: 'loading' }
	| { kind: 'ready'; url: string | undefined }
	| { kind: 'error'; message: string };

/**
 * The URL to display an attachment from. The admin runs on the WordPress site
 * itself, so the attachment's stored URL is the display URL; the resource
 * shape is kept so renderers handle loading and error states uniformly.
 */
export function useMediaResource(
	_id: number | undefined,
	canonical: string | undefined,
	_modified?: string,
): MediaState & { retry: () => void } {
	const retry = useCallback( () => {}, [] );
	return { kind: 'ready', url: canonical, retry };
}
