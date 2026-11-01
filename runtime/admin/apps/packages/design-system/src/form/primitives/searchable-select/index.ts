// Import required for TS to locate the underlying types
import type { Combobox as _Combobox } from '@base-ui/react/combobox';
import { SearchableSelect as _SearchableSelect } from './searchable-select';
import { Item } from '../combobox/item';

Item.displayName = 'SearchableSelect.Item';

export const SearchableSelect = Object.assign( _SearchableSelect, {
	Item,
} );
