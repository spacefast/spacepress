import { SearchableChipSelect as _SearchableChipSelect } from './searchable-chip-select';
import { Item } from '../combobox/item';
import { ChipWithRemove } from '../combobox/chip-with-remove';

Item.displayName = 'SearchableChipSelect.Item';
ChipWithRemove.displayName = 'SearchableChipSelect.ChipWithRemove';

export const SearchableChipSelect = Object.assign( _SearchableChipSelect, {
	Item,
	ChipWithRemove,
} );
