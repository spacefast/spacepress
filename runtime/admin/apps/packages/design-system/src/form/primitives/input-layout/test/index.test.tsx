import { render } from '@testing-library/react';
import { createRef } from 'react';
import { InputLayout } from '../index';
import { InputLayoutSlot } from '../slot';

describe( 'InputLayout', () => {
	it( 'forwards ref', () => {
		const layoutRef = createRef< HTMLDivElement >();
		const slotRef = createRef< HTMLDivElement >();

		render(
			<InputLayout
				ref={ layoutRef }
				prefix={
					<InputLayoutSlot ref={ slotRef }>Prefix</InputLayoutSlot>
				}
			>
				{ /* Input content would go here */ }
			</InputLayout>
		);

		expect( layoutRef.current ).toBeInstanceOf( HTMLDivElement );
		expect( slotRef.current ).toBeInstanceOf( HTMLDivElement );
	} );
} );
