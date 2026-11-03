import { allowed, bootstrap, collectionSpec, native, nativeEditor, read } from '@zero-admin/schema';
export const route = {
	canvas: async ({
		params,
	}: {
		params: { collection: string; slug: string };
	}) => {
		const c = await collectionSpec(params.collection),
			transport = native(params.collection);
		if (!transport || !c.content || !allowed(c.access.update, bootstrap().role))
			return undefined;
		try {
			const { row, editable } = await read(c, params.slug);
			if (!nativeEditor(c, row, editable)) return undefined;
		} catch {
			// The document screen presents transport/permission failures in its
			// normal loading/error state rather than breaking the whole router.
			return undefined;
		}
		return {
			postType: transport.postType,
			postId: params.slug,
			editLink: `/collections/${params.collection}/${encodeURIComponent(params.slug)}`,
		};
	},
};
