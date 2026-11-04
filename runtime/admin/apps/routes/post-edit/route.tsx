export const route = {
	canvas: async ( {
		params,
	}: {
		params: { type: string; id: string };
	} ) => ( {
		postType: params.type,
		postId: params.id,
	} ),
};
