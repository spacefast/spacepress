import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Link } from '../index';

describe( 'Link', () => {
	it( 'forwards ref', () => {
		const ref = createRef< HTMLAnchorElement >();

		render(
			<Link ref={ ref } href="/">
				Home
			</Link>
		);

		expect( ref.current ).toBeInstanceOf( HTMLAnchorElement );
	} );

	it( 'calls onClick handler when clicked', async () => {
		const user = userEvent.setup();
		const onClickMock = jest.fn( ( e: React.MouseEvent ) =>
			e.preventDefault()
		);

		render(
			<Link href="/page" onClick={ onClickMock }>
				Go to page
			</Link>
		);

		await user.click( screen.getByRole( 'link', { name: 'Go to page' } ) );

		expect( onClickMock ).toHaveBeenCalledTimes( 1 );
	} );

	describe( 'openInNewTab prop', () => {
		it( 'includes "(opens in a new tab)" in the accessible name', () => {
			render(
				<Link href="https://example.com" openInNewTab>
					Learn more
				</Link>
			);

			// Screen readers announce: "Learn more (opens in a new tab)"
			// The aria-label on the icon span contributes to the link's accessible name.
			expect(
				screen.getByRole( 'link', {
					name: 'Learn more (opens in a new tab)',
				} )
			).toBeInTheDocument();
		} );

		it( 'sets target="_blank" and rel noreferrer noopener; does not add external for internal href', () => {
			render(
				<Link href="/some-page" openInNewTab>
					Learn more
				</Link>
			);

			const link = screen.getByRole( 'link', {
				name: 'Learn more (opens in a new tab)',
			} );
			expect( link ).toHaveAttribute( 'target', '_blank' );
			const rel = link.getAttribute( 'rel' ) ?? '';
			expect( rel ).toContain( 'noreferrer' );
			expect( rel ).toContain( 'noopener' );
			expect( rel ).not.toContain( 'external' );
		} );

		it( 'merges caller-provided rel with defaults', () => {
			render(
				<Link href="https://example.com" openInNewTab rel="sponsored">
					Learn more
				</Link>
			);

			const link = screen.getByRole( 'link', {
				name: 'Learn more (opens in a new tab)',
			} );
			const rel = link.getAttribute( 'rel' ) ?? '';
			expect( rel ).toContain( 'sponsored' );
			expect( rel ).toContain( 'noreferrer' );
			expect( rel ).toContain( 'noopener' );
		} );

		it( 'prevents default click on hash links to avoid opening useless new tab', async () => {
			const user = userEvent.setup();
			render(
				<Link href="#section" openInNewTab>
					Jump to section
				</Link>
			);

			const link = screen.getByRole( 'link', {
				name: 'Jump to section (opens in a new tab)',
			} );

			const onClickMock = jest.fn();
			link.onclick = onClickMock;

			await user.click( link );

			expect( onClickMock ).toHaveBeenCalledTimes( 1 );
			expect( onClickMock ).toHaveBeenLastCalledWith(
				expect.objectContaining( { defaultPrevented: true } )
			);
		} );

		it( 'still calls user onClick for hash links', async () => {
			const user = userEvent.setup();
			const onClickMock = jest.fn();

			render(
				<Link href="#section" openInNewTab onClick={ onClickMock }>
					Jump to section
				</Link>
			);

			const link = screen.getByRole( 'link', {
				name: 'Jump to section (opens in a new tab)',
			} );
			await user.click( link );

			expect( onClickMock ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'does not set target or rel when openInNewTab is false', () => {
			render(
				<Link href="/" openInNewTab={ false }>
					Home
				</Link>
			);

			const link = screen.getByRole( 'link', { name: 'Home' } );
			expect( link ).not.toHaveAttribute( 'target' );
			expect( link ).not.toHaveAttribute( 'rel' );
		} );

		it( 'does not render the icon when openInNewTab is false', () => {
			render(
				<Link href="/" openInNewTab={ false }>
					Home
				</Link>
			);

			const link = screen.getByRole( 'link', { name: 'Home' } );
			// Only one child (the text), no icon span.
			expect( link.querySelector( '[aria-label]' ) ).toBeNull();
		} );
	} );
} );
