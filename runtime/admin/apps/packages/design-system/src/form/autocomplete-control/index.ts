// Import required for TS to locate the underlying types
import type { Autocomplete as _Autocomplete } from '@base-ui/react/autocomplete';
import { AutocompleteControl as _AutocompleteControl } from './main';
import { Item } from './item';

Item.displayName = 'AutocompleteControl.Item';

export const AutocompleteControl = Object.assign( _AutocompleteControl, {
	Item,
} );
