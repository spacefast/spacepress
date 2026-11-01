import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import * as Autocomplete from '../index';

const ITEMS = [
	{ id: '1', value: 'Item 1' },
	{ id: '2', value: 'Item 2' },
	{ id: '3', value: 'Item 3' },
];

describe( 'Autocomplete', () => {
	it( 'forwards ref', async () => {
		const user = userEvent.setup();
		const inputRef = createRef< HTMLInputElement >();
		const popupRef = createRef< HTMLDivElement >();
		const listRef = createRef< HTMLDivElement >();
		const listBodyRef = createRef< HTMLDivElement >();
		const itemRef = createRef< HTMLDivElement >();
		const clearRef = createRef< HTMLButtonElement >();
		const emptyRef = createRef< HTMLDivElement >();

		render(
			<Autocomplete.Root items={ ITEMS }>
				<Autocomplete.Input ref={ inputRef } placeholder="Search" />
				<Autocomplete.Popup ref={ popupRef }>
					<Autocomplete.Empty ref={ emptyRef }>
						No results found.
					</Autocomplete.Empty>
					<Autocomplete.List ref={ listRef }>
						<Autocomplete.ListBody ref={ listBodyRef }>
							<Autocomplete.Collection>
								{ ( item ) => (
									<Autocomplete.Item
										key={ item.id }
										ref={
											item.id === '1'
												? itemRef
												: undefined
										}
										value={ item }
									>
										{ item.value }
									</Autocomplete.Item>
								) }
							</Autocomplete.Collection>
						</Autocomplete.ListBody>
					</Autocomplete.List>
					<Autocomplete.Clear ref={ clearRef } />
				</Autocomplete.Popup>
			</Autocomplete.Root>
		);

		// Test input ref before interaction
		expect( inputRef.current ).toBeInstanceOf( HTMLInputElement );

		// Type in the input to open the autocomplete popup
		await user.type( inputRef.current!, 'Item' );

		// Now test that the popup and its child component refs are also available
		await waitFor( () => {
			expect( popupRef.current ).toBeInstanceOf( HTMLDivElement );
		} );
		expect( listRef.current ).toBeInstanceOf( HTMLDivElement );
		expect( listBodyRef.current ).toBeInstanceOf( HTMLDivElement );
		expect( itemRef.current ).toBeInstanceOf( HTMLDivElement );
		expect( clearRef.current ).toBeInstanceOf( HTMLButtonElement );
		expect( emptyRef.current ).toBeInstanceOf( HTMLDivElement );
	} );
} );
