import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';
import { CheckboxGroup, Checkbox } from '../../..';

const meta: Meta< typeof CheckboxGroup.Root > = {
	title: 'Design System/Form/Primitives/CheckboxGroup',
	component: CheckboxGroup.Root,
	subcomponents: {
		NestedItems: CheckboxGroup.NestedItems,
	},
	argTypes: {
		onValueChange: {
			action: fn(),
		},
	},
};

export default meta;

type Story = StoryObj< typeof CheckboxGroup.Root >;

export const Default: Story = {
	args: {
		children: [ 'Apple', 'Banana', 'Orange' ].map( ( label ) => (
			<Checkbox key={ label } value={ label } />
		) ),
		defaultValue: [],
	},
};

/**
 * `CheckboxGroup` can be used to control a group of checkboxes from a single parent checkbox.
 *
 * For screen reader accessibility, do not nest more than one level.
 *
 * See the <a href="?path=/docs/design-system-form-checkbox-groups--checkbox-groups#nesting" target="_top">`CheckboxGroups` documentation</a>
 *  for a full example.
 */
export const WithParentCheckbox: Story = {
	render: function Template( { onValueChange, ...args } ) {
		const [ value, setValue ] = useState< string[] >( [] );
		return (
			<CheckboxGroup.Root
				{ ...args }
				value={ value }
				onValueChange={ ( newValue, event ) => {
					setValue( newValue );
					onValueChange?.( newValue, event );
				} }
			/>
		);
	},
	args: {
		children: (
			<>
				<Checkbox value="Fruit" parent />

				<CheckboxGroup.NestedItems>
					{ [ 'Apple', 'Banana', 'Orange' ].map( ( label ) => (
						<Checkbox key={ label } value={ label } />
					) ) }
				</CheckboxGroup.NestedItems>
			</>
		),
		allValues: [ 'Apple', 'Banana', 'Orange' ],
	},
};
