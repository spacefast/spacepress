import clsx from 'clsx';
import { forwardRef } from 'react';
import { __ } from '@wordpress/i18n';
import { Field, Autocomplete } from '../primitives';
import { Item } from './item';
import styles from './style.module.css';
import type {
	AutocompleteControlItem,
	AutocompleteControlProps,
} from './types';

/**
 * An autocompleted `InputControl` that shows suggestions as you type.
 *
 * Unlike searchable select controls, the input can contain free-form text,
 * and suggestions only optionally autocomplete the text. If you need a control with a selection state
 * restricted to a set of allowed options, see `SearchableSelectControl` or `SearchableChipSelectControl`.
 */
export const AutocompleteControl = forwardRef<
	HTMLInputElement,
	AutocompleteControlProps
>( function AutocompleteControl(
	{
		className,
		children,
		items,
		label,
		description,
		placeholder,
		emptyContent = __( 'No results found.', 'wpds' ),
		render,
		...restProps
	},
	ref
) {
	return (
		<Field.Root className={ className }>
			<Field.Label>{ label }</Field.Label>
			<Autocomplete.Root items={ items } { ...restProps }>
				<Autocomplete.Input
					ref={ ref }
					placeholder={ placeholder }
					render={ render }
				/>
				<Autocomplete.Popup
					className={ clsx(
						styles.popup,
						emptyContent === false && styles[ 'hide-when-empty' ]
					) }
				>
					{ emptyContent !== false && (
						<Autocomplete.Empty>
							{ emptyContent }
						</Autocomplete.Empty>
					) }
					<Autocomplete.List>
						<Autocomplete.ListBody>
							<Autocomplete.Collection>
								{ children ||
									( ( item: AutocompleteControlItem ) => (
										<Item
											key={ item.value }
											value={ item }
											disabled={ item.disabled }
										>
											{ item.label }
										</Item>
									) ) }
							</Autocomplete.Collection>
						</Autocomplete.ListBody>
					</Autocomplete.List>
				</Autocomplete.Popup>
			</Autocomplete.Root>
			{ description && (
				<Field.Description>{ description }</Field.Description>
			) }
		</Field.Root>
	);
} );
