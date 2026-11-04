/**
 * Type definition for WordPress API error responses.
 */
export type WordPressError = {
	code: string;
	message: string;
	data: {
		status: number;
	};
};
