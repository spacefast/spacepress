import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SaveButton from '../index';

const mockSaveEditedEntityRecord = jest.fn();
const mockIsSavingEntityRecord = jest.fn();
const mockSelect = jest.fn();
const mockDispatch = jest.fn();

let dirtyEntityRecords: Array< {
	kind: string;
	name: string;
	key: string | number;
} > = [];

jest.mock( '@wordpress/core-data', () => ( {
	store: 'core',
} ) );

jest.mock( '@wordpress/data', () => ( {
	useDispatch: jest.fn( () => ( {
		saveEditedEntityRecord: mockSaveEditedEntityRecord,
	} ) ),
	useRegistry: jest.fn( () => ( {
		select: mockSelect,
		dispatch: mockDispatch,
	} ) ),
	useSelect: jest.fn( ( callback: ( select: unknown ) => unknown ) =>
		callback( mockSelect )
	),
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__: ( message: string ) => message,
} ) );

describe( 'SaveButton', () => {
	beforeEach( () => {
		dirtyEntityRecords = [];
		mockSaveEditedEntityRecord.mockReset();
		mockSaveEditedEntityRecord.mockResolvedValue( undefined );
		mockIsSavingEntityRecord.mockReset();
		mockIsSavingEntityRecord.mockReturnValue( false );
		mockSelect.mockReset();
		mockSelect.mockImplementation( () => ( {
			__experimentalGetDirtyEntityRecords: () => dirtyEntityRecords,
			isSavingEntityRecord: mockIsSavingEntityRecord,
		} ) );
		mockDispatch.mockReset();
		mockDispatch.mockImplementation( () => ( {
			saveEditedEntityRecord: mockSaveEditedEntityRecord,
		} ) );
	} );

	it( 'renders default Save label', () => {
		dirtyEntityRecords = [
			{
				kind: 'root',
				name: 'shipping_zone_method',
				key: -1,
			},
		];
		render( <SaveButton /> );

		expect(
			screen.getByRole( 'button', {
				name: 'Save',
			} )
		).toBeInTheDocument();
	} );

	it( 'renders custom label', () => {
		dirtyEntityRecords = [
			{
				kind: 'root',
				name: 'shipping_zone_method',
				key: -1,
			},
		];
		render( <SaveButton label="Add" /> );

		expect(
			screen.getByRole( 'button', {
				name: 'Add',
			} )
		).toBeInTheDocument();
	} );

	it( 'does not dispatch save requests on render', () => {
		dirtyEntityRecords = [
			{
				kind: 'root',
				name: 'shipping_zone_method',
				key: -1,
			},
		];

		render( <SaveButton /> );

		expect( mockSaveEditedEntityRecord ).not.toHaveBeenCalled();
	} );

	it( 'dispatches save requests on click when there are dirty records', async () => {
		dirtyEntityRecords = [
			{
				kind: 'root',
				name: 'shipping_zone_method',
				key: -1,
			},
			{
				kind: 'root',
				name: 'shipping_zone_method',
				key: 33,
			},
		];
		mockSaveEditedEntityRecord
			.mockResolvedValueOnce( { id: 1 } )
			.mockResolvedValueOnce( { id: 2 } );
		const onSave = jest.fn();

		render( <SaveButton onSave={ onSave } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => {
			expect( mockSaveEditedEntityRecord ).toHaveBeenCalledTimes( 2 );
		} );

		expect( mockSaveEditedEntityRecord ).toHaveBeenNthCalledWith(
			1,
			'root',
			'shipping_zone_method',
			-1,
			{ throwOnError: true }
		);
		expect( mockSaveEditedEntityRecord ).toHaveBeenNthCalledWith(
			2,
			'root',
			'shipping_zone_method',
			33,
			{ throwOnError: true }
		);
		await waitFor( () => {
			expect( onSave ).toHaveBeenCalledWith( [ { id: 1 }, { id: 2 } ] );
		} );
	} );

	it( 'is disabled when there are no dirty records', () => {
		render( <SaveButton label="Add" /> );

		expect( screen.getByRole( 'button', { name: 'Add' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	} );

	it( 'shows a pending state immediately while save is in flight', async () => {
		dirtyEntityRecords = [
			{
				kind: 'root',
				name: 'shipping_zone_method',
				key: -1,
			},
		];
		let resolveSave: ( value: { id: number } ) => void = () => undefined;

		mockSaveEditedEntityRecord.mockImplementation(
			() =>
				new Promise( ( resolve: ( value: { id: number } ) => void ) => {
					resolveSave = resolve;
				} )
		);

		render( <SaveButton /> );

		const saveButton = screen.getByRole( 'button', { name: 'Save' } );

		fireEvent.click( saveButton );

		await waitFor( () => {
			expect( saveButton ).toHaveAttribute( 'aria-disabled', 'true' );
		} );

		resolveSave( { id: 1 } );

		await waitFor( () => {
			expect( mockSaveEditedEntityRecord ).toHaveBeenCalledTimes( 1 );
		} );
	} );

	it( 'does not trigger a second save while a save is already pending', async () => {
		dirtyEntityRecords = [
			{
				kind: 'root',
				name: 'shipping_zone_method',
				key: -1,
			},
		];
		let resolveSave: ( value: { id: number } ) => void = () => undefined;

		mockSaveEditedEntityRecord.mockImplementation(
			() =>
				new Promise( ( resolve: ( value: { id: number } ) => void ) => {
					resolveSave = resolve;
				} )
		);

		render( <SaveButton /> );

		const saveButton = screen.getByRole( 'button', { name: 'Save' } );

		fireEvent.click( saveButton );

		await waitFor( () => {
			expect( saveButton ).toHaveAttribute( 'aria-disabled', 'true' );
		} );

		fireEvent.click( saveButton );

		expect( mockSaveEditedEntityRecord ).toHaveBeenCalledTimes( 1 );

		resolveSave( { id: 1 } );

		await waitFor( () => {
			expect( mockSaveEditedEntityRecord ).toHaveBeenCalledTimes( 1 );
		} );
	} );
} );
