import { render } from '@testing-library/react';
import UnsavedChangesWarning from '../index';

let mockDirtyRecords: unknown[] = [];
let mockEntityValidity: {
	isEntityValid: boolean;
	documentChanges?: { dirty?: boolean; valid?: boolean };
} = { isEntityValid: true };

jest.mock( '@wordpress/data', () => ( {
	useSelect: ( selector: ( select: () => unknown ) => unknown ) =>
		selector( () => ( {
			__experimentalGetDirtyEntityRecords: () => mockDirtyRecords,
		} ) ),
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	store: 'core',
} ) );

jest.mock( '@spacepress-admin/admin-toolkit', () => ( {
	useEntityValidity: () => mockEntityValidity,
} ) );

describe( 'UnsavedChangesWarning embed dirty event', () => {
	beforeEach( () => {
		mockDirtyRecords = [];
		mockEntityValidity = { isEntityValid: true };
	} );

	it( 'dispatches spacefast:embed:dirty when dirty state changes', () => {
		const observed: boolean[] = [];
		const onDirty = ( event: Event ) => {
			observed.push(
				Boolean( ( event as CustomEvent< { dirty?: boolean } > ).detail?.dirty )
			);
		};
		window.addEventListener( 'spacefast:embed:dirty', onDirty );

		try {
			const { rerender } = render( <UnsavedChangesWarning /> );
			expect( observed ).toEqual( [ false ] );

			mockDirtyRecords = [ { key: 'post:1' } ];
			rerender( <UnsavedChangesWarning /> );
			expect( observed ).toEqual( [ false, true ] );

			mockDirtyRecords = [];
			rerender( <UnsavedChangesWarning /> );
			expect( observed ).toEqual( [ false, true, false ] );
		} finally {
			window.removeEventListener( 'spacefast:embed:dirty', onDirty );
		}
	} );
} );
