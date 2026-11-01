import { Link, privateApis as routePrivateApis } from '@wordpress/route';
import { unlock } from '@zero-admin/private-apis';
import SiteIcon from '../site-icon';
import './style.scss';

const { useCanGoBack, useRouter } = unlock( routePrivateApis );

function SiteIconLink( {
	to,
	isBackButton,
	...props
}: {
	to: string;
	'aria-label': string;
	isBackButton?: boolean;
} ) {
	const router = useRouter();
	const canGoBack = useCanGoBack();

	return (
		<Link
			to={ to }
			aria-label={ props[ 'aria-label' ] }
			className="zero-admin-site-icon-link"
			onClick={ ( event ) => {
				// If possible, restore the previous page with
				// filters etc.
				if ( canGoBack && isBackButton ) {
					event.preventDefault();
					router.history.back();
				}
			} }
		>
			<SiteIcon />
		</Link>
	);
}

export default SiteIconLink;
