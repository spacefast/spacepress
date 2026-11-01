import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { link } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { AutocompleteControl, Input, InputLayout } from '../..';
import type { AutocompleteControlItem } from './types';

const URLS: AutocompleteControlItem[] = [
	{ label: 'wordpress.org', value: 'wordpress.org' },
	{
		label: 'developer.wordpress.org/plugins/',
		value: 'developer.wordpress.org/plugins/',
	},
	{
		label: 'developer.wordpress.org/themes/',
		value: 'developer.wordpress.org/themes/',
	},
	{
		label: 'developer.wordpress.org/block-editor/',
		value: 'developer.wordpress.org/block-editor/',
	},
	{
		label: 'github.com/WordPress/gutenberg',
		value: 'github.com/WordPress/gutenberg',
	},
];

const meta: Meta< typeof AutocompleteControl > = {
	title: 'Design System/Form/AutocompleteControl',
	component: AutocompleteControl,
	subcomponents: {
		Item: AutocompleteControl.Item,
	},
};

export default meta;

type Story = StoryObj< typeof AutocompleteControl >;

export const Default: Story = {
	args: {
		label: 'Label',
		description: 'This is the description.',
		placeholder: 'Enter a URL',
		items: URLS,
	},
};

/**
 * Use `children` as a render function to customise how each item is
 * displayed in the dropdown. The function receives each item and should
 * return an `AutocompleteControl.Item` element.
 */
export const WithCustomItems: Story = {
	args: {
		...Default.args,
		children: ( item: AutocompleteControlItem ) => (
			<AutocompleteControl.Item key={ item.value } value={ item }>
				🔗 { item.label }
			</AutocompleteControl.Item>
		),
	},
};

/**
 * Use the `emptyContent` prop to customize the empty state,
 * shown when no items match the current input.
 */
export const WithCustomEmptyContent: Story = {
	args: {
		...Default.args,
		emptyContent: 'Nothing found — try a different search.',
	},
};

/**
 * Set `emptyContent` to `false` to hide the popup whenever no items
 * match the current input, instead of showing an empty-state message.
 */
export const WithNoEmptyContent: Story = {
	args: {
		...Default.args,
		emptyContent: false,
	},
};

/**
 * Use the `render` prop to customise the input element.
 * For example, additional props such as `prefix`, `suffix`, `required`, or `type`
 * can be passed to an `Input` primitive here.
 */
export const WithCustomInput: Story = {
	args: {
		...Default.args,
		render: (
			<Input
				prefix={
					<InputLayout.Slot padding="minimal">
						<Icon icon={ link } />
					</InputLayout.Slot>
				}
			/>
		),
	},
};

/**
 * When `openOnInputClick` is enabled, the popup opens as soon as the
 * input is clicked, showing all available items before the user types.
 */
export const OpenOnInputClick: Story = {
	args: {
		...Default.args,
		openOnInputClick: true,
	},
};

/**
 * When `autoHighlight` is enabled, the first matching item is
 * automatically highlighted as the user types, so pressing Enter
 * immediately selects it.
 */
export const AutoHighlight: Story = {
	args: {
		...Default.args,
		autoHighlight: true,
	},
};

/**
 * Items and empty content can be updated dynamically. In this example,
 * a simulated async search is triggered on each input change.
 *
 * Use `filteredItems` instead of `items` when filtering is done externally
 * (e.g. by an API) to bypass the component's internal filter.
 */
export const AsyncItems: Story = {
	render: function Template( args ) {
		const [ query, setQuery ] = useState( '' );
		const [ loading, setLoading ] = useState( false );
		const [ results, setResults ] = useState< AutocompleteControlItem[] >(
			[]
		);

		return (
			<AutocompleteControl
				{ ...args }
				filteredItems={ results }
				value={ query }
				onValueChange={ ( newValue ) => {
					setQuery( newValue );

					if ( ! newValue.length ) {
						setResults( [] );
						return;
					}

					setLoading( true );
					// Simulate an async search.
					setTimeout( () => {
						setResults(
							URLS.filter( ( item ) =>
								item.label
									.toLowerCase()
									.includes( newValue.toLowerCase() )
							)
						);
						setLoading( false );
					}, 500 );
				} }
				emptyContent={ loading ? 'Loading…' : undefined }
			/>
		);
	},
	args: {
		...Default.args,
	},
};
