import { useParams } from '@wordpress/route';
import { Page } from '@first-admin/admin-toolkit';
import { ScreenBody } from '@first-admin/screens';

/** First Admin's host for a declared screen (runtime/admin/lib/screens.php). */
export default function Stage() {
	const { id } = useParams( { from: '/screens/$id' } ) as { id: string };
	return (
		<ScreenBody
			id={ id }
			host="first-admin"
			frame={ ( screen, body ) => (
				<Page title={ screen?.title ?? '' } subTitle={ screen?.description || undefined }>
					<div className="first-admin-screen-page">{ body }</div>
				</Page>
			) }
		/>
	);
}
