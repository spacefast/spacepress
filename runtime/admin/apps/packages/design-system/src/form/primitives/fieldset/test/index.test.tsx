import { render } from '@testing-library/react';
import { createRef } from 'react';
import * as Fieldset from '../index';

describe( 'Fieldset', () => {
	it( 'forwards ref', () => {
		const rootRef = createRef< HTMLFieldSetElement >();
		const legendRef = createRef< HTMLDivElement >();
		const descriptionRef = createRef< HTMLParagraphElement >();

		render(
			<Fieldset.Root ref={ rootRef }>
				<Fieldset.Legend ref={ legendRef }>
					Fieldset Legend
				</Fieldset.Legend>
				<Fieldset.Description ref={ descriptionRef }>
					Fieldset description
				</Fieldset.Description>
				{ /* Field content would go here */ }
			</Fieldset.Root>
		);

		expect( rootRef.current ).toBeInstanceOf( HTMLFieldSetElement );
		expect( legendRef.current ).toBeInstanceOf( HTMLDivElement );
		expect( descriptionRef.current ).toBeInstanceOf( HTMLParagraphElement );
	} );
} );
