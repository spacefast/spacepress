export interface WordPressError {
	code: string;
	message: string;
	data: {
		status: number;
	};
}
