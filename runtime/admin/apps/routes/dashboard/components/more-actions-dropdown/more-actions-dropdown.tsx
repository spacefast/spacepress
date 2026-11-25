import { unlock } from '@spacepress-admin/admin-toolkit';
import { IconButton } from '@wordpress/ui';
import { privateApis as componentsPrivateApis } from '@wordpress/components';
import { moreVertical } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { Menu } = unlock( componentsPrivateApis );

interface MoreActionsDropdownProps {
	items?: Array< {
		label: string;
		onClick: () => void;
		disabled?: boolean;
	} >;
}

export function MoreActionsDropdown( {
	items = [],
}: MoreActionsDropdownProps ) {
	return (
		<Menu onOpenChange={ () => {} }>
			<Menu.TriggerButton
				render={
					<IconButton
						icon={ moreVertical }
						variant="minimal"
						size="compact"
						label={ __( 'More actions', 'spacepress-admin' ) }
					/>
				}
			/>
			<Menu.Popover>
				{ items.map( ( item, index ) => (
					<Menu.Item
						key={ `${ item.label }-${ index }` }
						disabled={ item.disabled }
						onClick={ item.onClick }
					>
						<Menu.ItemLabel>{ item.label }</Menu.ItemLabel>
					</Menu.Item>
				) ) }
			</Menu.Popover>
		</Menu>
	);
}
