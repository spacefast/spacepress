import type { Input } from '../primitives/input';
import type { ControlProps } from '../../utils/types';
import type {
	AutocompleteCollectionProps,
	AutocompleteEmptyProps,
	AutocompleteInputProps,
	AutocompleteRootProps,
} from '../primitives/autocomplete/types';

export type AutocompleteControlItem = {
	label: string;
	value: string;
	disabled?: boolean;
};

export type AutocompleteControlProps = Omit<
	AutocompleteRootProps,
	'items' | 'children' | 'inline'
> &
	Pick< React.ComponentProps< typeof Input >, 'placeholder' > &
	ControlProps & {
		/**
		 * CSS class to apply.
		 */
		className?: string;
		/**
		 * The array of option items to render in the autocomplete.
		 */
		items?: AutocompleteControlItem[];
		/**
		 * The content to display when no items match the input.
		 *
		 * Set to `false` to hide the popup when no items match.
		 *
		 * @default 'No results found.'
		 */
		emptyContent?: AutocompleteEmptyProps[ 'children' ];
		/**
		 * A render function for custom item rendering. Receives each item
		 * and should return an `AutocompleteControl.Item` element.
		 *
		 * When not provided, items are rendered with their `label` property.
		 */
		children?: AutocompleteCollectionProps[ 'children' ];
		/**
		 * A custom render element can be used to pass additional
		 * props to an `Input`, like `type` or `prefix`.
		 *
		 * ```jsx
		 * <AutocompleteControl
		 *   render={ <Input type="url" prefix={ <Icon icon={ link } /> } /> }
		 * />
		 * ```
		 */
		render?: AutocompleteInputProps[ 'render' ];
	};
