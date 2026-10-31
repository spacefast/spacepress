// Import required for TS to locate the underlying types
import type { Select as _Select } from '@base-ui/react/select';
import { SelectControl as _SelectControl } from './main';
import { Item } from './item';

Item.displayName = 'SelectControl.Item';

export const SelectControl = Object.assign( _SelectControl, {
	Item,
} );
