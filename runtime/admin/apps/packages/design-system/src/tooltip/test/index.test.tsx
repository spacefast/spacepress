import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import * as Tooltip from '../index';

describe( 'Tooltip', () => {
	it( 'forwards ref', async () => {
		const user = userEvent.setup();
		const triggerRef = createRef< HTMLButtonElement >();
		const popupRef = createRef< HTMLDivElement >();

		render(
			<Tooltip.Root>
				<Tooltip.Trigger ref={ triggerRef }>
					<span>Hover me</span>
				</Tooltip.Trigger>
				<Tooltip.Popup ref={ popupRef }>Tooltip text</Tooltip.Popup>
			</Tooltip.Root>
		);

		// Test trigger ref before interaction
		expect( triggerRef.current ).toBeInstanceOf( HTMLButtonElement );

		// Hover over the trigger to open the tooltip
		await user.hover( triggerRef.current! );

		// Wait for the tooltip popup to appear
		await waitFor( () => {
			expect( popupRef.current ).toBeInstanceOf( HTMLDivElement );
		} );
	} );
} );
