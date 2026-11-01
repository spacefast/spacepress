import getNoticeFromSettledResults from './get-notice-from-settled-results';

const createFulfilledResult = (): PromiseFulfilledResult< unknown > => ( {
	status: 'fulfilled',
	value: undefined,
} );

const createRejectedResult = (): PromiseRejectedResult => ( {
	status: 'rejected',
	reason: {},
} );

const createCoreDataRejectedResult = (
	message: string
): PromiseRejectedResult => ( {
	status: 'rejected',
	reason: {
		message,
	},
} );

const createApiFetchRejectedResult = (
	message: string
): PromiseRejectedResult => ( {
	status: 'rejected',
	reason: {
		data: {
			message,
		},
	},
} );

describe( 'getNoticeFromSettledResults', () => {
	it( 'returns success message with count when all results are fulfilled and count is 1', () => {
		const result = getNoticeFromSettledResults( {
			results: [ createFulfilledResult() ],
			messages: {
				success: ( count ) => `${ count } items succeeded`,
				error: ( count ) => `${ count } items failed`,
			},
		} );

		expect( result ).toEqual( {
			kind: 'success',
			message: '1 items succeeded',
			successCount: 1,
			errorCount: 0,
		} );
	} );

	it( 'returns success message with count when all results are fulfilled and count is greater than 1', () => {
		const result = getNoticeFromSettledResults( {
			results: [ createFulfilledResult(), createFulfilledResult() ],
			messages: {
				success: ( count ) => `${ count } items succeeded`,
				error: ( count ) => `${ count } items failed`,
			},
		} );

		expect( result ).toEqual( {
			kind: 'success',
			message: '2 items succeeded',
			successCount: 2,
			errorCount: 0,
		} );
	} );

	it( 'returns error message with count when all results are rejected and count is 1', () => {
		const result = getNoticeFromSettledResults( {
			results: [ createRejectedResult() ],
			messages: {
				success: ( count ) => `${ count } items succeeded`,
				error: ( count ) => `${ count } items failed`,
			},
		} );

		expect( result ).toEqual( {
			kind: 'error',
			message: '1 items failed',
			successCount: 0,
			errorCount: 1,
		} );
	} );

	it( 'returns error message with count when all results are rejected and count is greater than 1', () => {
		const result = getNoticeFromSettledResults( {
			results: [ createRejectedResult(), createRejectedResult() ],
			messages: {
				success: ( count ) => `${ count } items succeeded`,
				error: ( count ) => `${ count } items failed`,
			},
		} );

		expect( result ).toEqual( {
			kind: 'error',
			message: '2 items failed',
			successCount: 0,
			errorCount: 2,
		} );
	} );

	it( 'uses backend error response message for single failure', () => {
		const result = getNoticeFromSettledResults( {
			results: [ createCoreDataRejectedResult( 'Coupon is locked' ) ],
			messages: {
				success: ( count ) => `${ count } items succeeded`,
				error: ( count ) => `${ count } items failed`,
			},
		} );

		expect( result.message ).toBe( 'Coupon is locked' );
	} );

	it( 'uses backend API error response message for single failure', () => {
		const result = getNoticeFromSettledResults( {
			results: [
				createApiFetchRejectedResult( 'Subscriber cannot be updated' ),
			],
			messages: {
				success: ( count ) => `${ count } items succeeded`,
				error: ( count ) => `${ count } items failed`,
			},
		} );

		expect( result.message ).toBe( 'Subscriber cannot be updated' );
	} );

	it( 'joins unique backend error messages for multiple failures', () => {
		const result = getNoticeFromSettledResults( {
			results: [
				createCoreDataRejectedResult( 'Error A' ),
				createCoreDataRejectedResult( 'Error B' ),
				createCoreDataRejectedResult( 'Error A' ),
			],
			messages: {
				success: ( count ) => `${ count } items succeeded`,
				error: ( count ) => `${ count } items failed`,
			},
		} );

		expect( result.message ).toBe( 'Error A, Error B' );
	} );

	it( 'falls back to error message with count for mixed results when backend messages are missing', () => {
		const result = getNoticeFromSettledResults( {
			results: [ createFulfilledResult(), createRejectedResult() ],
			messages: {
				success: ( count ) => `${ count } items succeeded`,
				error: ( count ) => `${ count } items failed`,
			},
		} );

		expect( result.message ).toBe( '1 items failed' );
	} );
} );
