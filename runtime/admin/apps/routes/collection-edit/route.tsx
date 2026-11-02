import { allowed, bootstrap, collectionSpec, native } from '@zero-admin/schema';
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
		return {
			postType: transport.postType,
			postId: params.slug,
			editLink: `/collections/${params.collection}/${encodeURIComponent(params.slug)}`,
		};
	},
};
