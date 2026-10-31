// Import required for TS to locate the underlying types
import type { Combobox as _Combobox } from '@base-ui/react/combobox';
import { SearchableSelectControl as _SearchableSelectControl } from './main';
import { Item } from '../primitives/combobox/item';

Item.displayName = 'SearchableSelectControl.Item';

export const SearchableSelectControl = Object.assign(
	_SearchableSelectControl,
	{
		Item,
	}
);
