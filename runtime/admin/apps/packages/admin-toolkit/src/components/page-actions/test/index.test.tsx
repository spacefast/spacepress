import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Action } from '@spacepress-admin/dataviews';
import PageActions, { type PageActionConfig } from '../index';

const mockRegistry = {};
const mockNavigate = jest.fn();

jest.mock( '@wordpress/data', () => ( {
	useRegistry: () => mockRegistry,
} ) );

jest.mock( '@wordpress/route', () => ( {
	useNavigate: () => mockNavigate,
} ) );

jest.mock( '@wordpress/components', () => ( {
	DropdownMenu: ( {
		controls,
	}: {
		controls: Array< {
			id: string;
			title: string;
			onClick: () => void;
		} >;
	} ) => (
		<div>
			{ controls.map( ( control ) => (
				<button key={ control.id } onClick={ control.onClick }>
					{ control.title }
				</button>
			) ) }
		</div>
	),
	Modal: ( { children }: { children: React.ReactNode } ) => (
		<div>{ children }</div>
	),
} ) );

describe( 'PageActions', () => {
	const item = {
		id: 1,
		name: 'Sample item',
	};

	beforeEach( () => {
		mockNavigate.mockReset();
	} );

	it( 'passes onActionPerformed to callback actions via context', async () => {
		const onActionPerformed = jest.fn();
		const callback = jest.fn( async ( items, context ) => {
			await context.onActionPerformed?.( items );
		} );
		const action: Action< typeof item > = {
			id: 'archive',
			label: 'Archive',
			isEligible: () => true,
			callback,
		};
		const actions: PageActionConfig< typeof item >[] = [
			{
				action,
				onActionPerformed,
			},
		];

		render( <PageActions item={ item } actions={ actions } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Archive' } ) );

		await waitFor( () => {
			expect( callback ).toHaveBeenCalledWith(
				[ item ],
				expect.objectContaining( {
					registry: mockRegistry,
					onActionPerformed: expect.any( Function ),
				} )
			);
			expect( onActionPerformed ).toHaveBeenCalledWith( [ item ] );
		} );
	} );

	it( 'excludes ineligible actions from the menu', () => {
		const eligibleAction: Action< typeof item > = {
			id: 'edit',
			label: 'Edit',
			isEligible: () => true,
			callback: jest.fn(),
		};
		const ineligibleAction: Action< typeof item > = {
			id: 'delete',
			label: 'Delete',
			isEligible: () => false,
			callback: jest.fn(),
		};
		const actions: PageActionConfig< typeof item >[] = [
			{ action: eligibleAction },
			{ action: ineligibleAction },
		];

		render( <PageActions item={ item } actions={ actions } /> );

		expect(
			screen.getByRole( 'button', { name: 'Edit' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Delete' } )
		).not.toBeInTheDocument();
	} );

	it( 'does not call onActionPerformed when the callback action does not invoke the context callback', async () => {
		const onActionPerformed = jest.fn();
		const action: Action< typeof item > = {
			id: 'archive',
			label: 'Archive',
			isEligible: () => true,
			callback: jest.fn().mockResolvedValue( undefined ),
		};
		const actions: PageActionConfig< typeof item >[] = [
			{
				action,
				onActionPerformed,
			},
		];

		render( <PageActions item={ item } actions={ actions } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Archive' } ) );

		await waitFor( () => {
			expect( action.callback ).toHaveBeenCalledTimes( 1 );
		} );
		expect( onActionPerformed ).not.toHaveBeenCalled();
	} );
} );
