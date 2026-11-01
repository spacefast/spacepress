import { Badge } from '@wordpress/ui';

type MenuBadgeProps = {
	badge?: string | number | null;
};

export default function MenuBadge( { badge }: MenuBadgeProps ) {
	if ( badge === null || badge === undefined || badge === '' ) {
		return null;
	}

	return <Badge>{ String( badge ) }</Badge>;
}
