import { IconButton, Link, Stack } from '@wordpress/ui';
import { SiteIconLink } from '@first-admin/admin-toolkit';
import { useSelect, useDispatch } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { store as coreStore } from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import { search } from '@wordpress/icons';
import { rawShortcut, displayShortcut, shortcutAriaLabel } from '@wordpress/keycodes';
// @ts-expect-error Commands package is not typed yet.
import { store as commandsStore } from '@wordpress/commands';
import { filterURLForDisplay } from '@wordpress/url';
import type { UnstableBase } from '@wordpress/core-data';
import './style.scss';

const OPEN_COMMAND_BAR_SHORTCUT_INFO = {
	displayShortcut: displayShortcut.primary( 'k' ),
	// TODO: use `ariaKeyShortcut` instead of `rawShortcut` once
	// https://github.com/WordPress/gutenberg/pull/74205 is merged
	ariaKeyShortcut: rawShortcut.primary( 'k' ),
	label: shortcutAriaLabel.primary( 'k' ),
};

function SiteHub() {
	const { homeUrl, siteTitle } = useSelect( ( select ) => {
		const { getEntityRecord } = select( coreStore );
		const _base = getEntityRecord< UnstableBase >(
			'root',
			'__unstableBase'
		);
		return {
			homeUrl: _base?.home,
			siteTitle:
				! _base?.name && !! _base?.url
					? filterURLForDisplay( _base?.url )
					: _base?.name,
		};
	}, [] );

	// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-type-assertion -- Commands package is not typed yet.
	const { open: openCommandCenter } = useDispatch( commandsStore ) as {
		open: () => void;
	};
	const label = __( 'Open command palette', 'first-admin' );

	return (
		<div className="first-admin-site-hub">
			<SiteIconLink
				to="/"
				aria-label={ __( 'Go to the Dashboard', 'first-admin' ) }
			/>
			<Link
				href={ homeUrl ?? '/' }
				openInNewTab
				className="first-admin-site-hub__title"
			>
				{ /* The stylesheet sizes the first span child: @wordpress/ui's Link no longer adds one. */ }
				<span>
					<div className="first-admin-site-hub__title-text">
						{ siteTitle && decodeEntities( siteTitle ) }
					</div>
					<div className="first-admin-site-hub__url">
						{ homeUrl ? filterURLForDisplay( homeUrl ) : '/' }
					</div>
				</span>
			</Link>
			<Stack direction="row" className="first-admin-site-hub__actions">
				<IconButton
					variant="minimal"
					tone="neutral"
					icon={ search }
					onClick={ () => openCommandCenter() }
					size="compact"
					label={ label }
					shortcut={ OPEN_COMMAND_BAR_SHORTCUT_INFO }
				/>
			</Stack>
		</div>
	);
}

export default SiteHub;
