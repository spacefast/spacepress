import { createRef } from 'react';
import { render } from '@testing-library/react';
import { Button } from '@wordpress/ui';
import { Actions } from '../index';

describe( 'EmptyState.Actions', () => {
	it( 'forwards ref', () => {
		const ref = createRef< HTMLDivElement >();

		render(
			<Actions ref={ ref }>
				<Button>Action</Button>
			</Actions>
		);

		expect( ref.current ).toBeInstanceOf( HTMLDivElement );
	} );
} );
