import apiFetch from '@wordpress/api-fetch';
import { object, unwrap } from '@zero-admin/schema';

// Native image blocks use core's media transport internally. Keep that transport's
// response shape while applying the same Zero mutation rules as the media screen.
apiFetch.use(async (options, next) => {
	const url = new URL(
		options.path ?? options.url ?? '',
		window.location.origin
	);
	const match = url.pathname.match(
		/(?:^|\/)wp\/v2\/media(?:\/(\d+))?(\/edit)?\/?$/
	);
	const method = (options.method ?? 'GET').toUpperCase();
	if (!match || ['GET', 'HEAD', 'OPTIONS'].includes(method))
		return next(options);
	const [, id, edit] = match;
	if (edit)
		throw new Error(
			'Image cropping is unavailable here. Use the media focal point control.'
		);
	const zeroOptions = {
		...options,
		url: undefined,
		path: id ? `/zero/v1/media/${id}` : '/zero/v1/media',
	};
	if (method === 'DELETE') return next(zeroOptions);
	if (!id) {
		const uploaded: unknown = await next(zeroOptions);
		const row = object(unwrap(uploaded));
		if (typeof row.id !== 'number')
			throw new Error('The upload returned no media identity.');
		return next({ path: `/wp/v2/media/${row.id}?context=edit` });
	}
	const data: unknown = options.data;
	if (data && typeof data === 'object' && 'alt_text' in data) {
		const fields = object(data),
			alt = fields.alt_text;
		delete fields.alt_text;
		await next({ ...zeroOptions, method: 'PATCH', data: { alt } });
		if (Object.keys(fields).length) return next({ ...options, data: fields });
		return next({ path: `/wp/v2/media/${id}?context=edit` });
	}
	// Caption and title remain WordPress fields with WordPress capabilities.
	return next(options);
});
