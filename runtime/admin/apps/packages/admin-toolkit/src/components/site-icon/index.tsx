import clsx from 'clsx';
import { useSelect } from '@wordpress/data';
import { Icon } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';
import { wordpress } from '@wordpress/icons';
import { store as coreDataStore } from '@wordpress/core-data';
import type { UnstableBase } from '@wordpress/core-data';
import './style.scss';

function SiteIcon( { className }: { className?: string } ) {
	const { isRequestingSite, siteIconUrl } = useSelect( ( select ) => {
		const { getEntityRecord } = select( coreDataStore );
		const siteData = getEntityRecord< UnstableBase >(
			'root',
			'__unstableBase',
			undefined
		);

		return {
			isRequestingSite: ! siteData,
			siteIconUrl: siteData?.site_icon_url,
		};
	}, [] );

	let icon = null;

	if ( isRequestingSite && ! siteIconUrl ) {
		icon = <div className="zero-admin-site-icon__image" />;
	} else {
		icon = siteIconUrl ? (
			<img
				className="zero-admin-site-icon__image"
				alt={ __( 'Site Icon', 'zero-admin' ) }
				src={ siteIconUrl }
			/>
		) : (
			<Icon
				className="zero-admin-site-icon__icon"
				icon={ wordpress }
				size={ 48 }
			/>
		);
	}

	return (
		<div className={ clsx( className, 'zero-admin-site-icon' ) }>
			{ icon }
		</div>
	);
}

export default SiteIcon;
