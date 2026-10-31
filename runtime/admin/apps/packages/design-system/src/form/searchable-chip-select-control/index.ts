import { SearchableChipSelectControl as _SearchableChipSelectControl } from './searchable-chip-select-control';
import { Item } from '../primitives/combobox/item';
import { ChipWithRemove } from '../primitives/combobox/chip-with-remove';

Item.displayName = 'SearchableChipSelectControl.Item';
ChipWithRemove.displayName = 'SearchableChipSelectControl.ChipWithRemove';

export const SearchableChipSelectControl = Object.assign(
	_SearchableChipSelectControl,
	{
		Item,
		ChipWithRemove,
	}
);
