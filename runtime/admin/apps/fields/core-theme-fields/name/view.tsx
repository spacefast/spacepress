import { unlock } from '@first-admin/admin-toolkit';
import {
	privateApis as componentsPrivateApis,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import type { Theme } from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import { __ } from '@wordpress/i18n';

export default function ThemeNameView( { item }: { item: Theme } ) {
	const themeName = decodeEntities( item.name.rendered );
	const activeTheme = item.status === 'active';
	const { Badge } = unlock( componentsPrivateApis );
	return (
		<HStack alignment="center" justify="text-start">
			<span>{ themeName }</span>
			{ activeTheme && <Badge>{ __( 'Active', 'first-admin' ) }</Badge> }
		</HStack>
	);
}
