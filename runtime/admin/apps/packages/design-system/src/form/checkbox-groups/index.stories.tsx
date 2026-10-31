import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { CheckboxControl, CheckboxGroup, Fieldset } from '../..';

const meta: Meta = {
	title: 'Design System/Form/Checkbox Groups',
	tags: [ '!autodocs', '!dev' ],
};
export default meta;

/**
 * Checkbox groups can be composed from `CheckboxGroup` and `CheckboxControl`.
 *
 * In this example, the group is wrapped in a `Fieldset` with a legend and description.
 * When not using `Fieldset`, don't forget to accessibly label the `CheckboxGroup`, for example with
 * the `aria-labelledby` prop on the `CheckboxGroup`.
 *
 * The checked states of all the checkboxes can be controlled through the `CheckboxGroup` component,
 * through the `value`/`defaultValue` and `onValueChange` props.
 */
export const GroupingCheckboxes: StoryObj = {
	render: function Template() {
		return (
			<Fieldset.Root>
				<Fieldset.Legend>Legend</Fieldset.Legend>
				<Fieldset.Description>
					This is the description for the entire fieldset.
				</Fieldset.Description>
				<CheckboxGroup.Root
					defaultValue={ [ '1' ] }
					// eslint-disable-next-line no-console
					onValueChange={ console.log }
				>
					<CheckboxControl
						value="1"
						label="Item 1"
						description="This is the description."
					/>
					<CheckboxControl
						value="2"
						label="Item 2"
						description="This is the description."
					/>
					<CheckboxControl
						value="3"
						label="Item 3"
						description="This is the description."
					/>
				</CheckboxGroup.Root>
			</Fieldset.Root>
		);
	},
};

/**
 * To control a group of checkboxes from a single parent checkbox:
 *
 * 1. Use `CheckboxGroup` in controlled mode.
 * 2. Pass an array of the child checkbox values to the `allValues` prop.
 * 3. Mark the parent checkbox with the `parent` boolean prop.
 *
 * A `CheckboxGroup.NestedItems` component is also available for adding standard indentation
 * to the nested checkbox items.
 *
 * In this example, there are two `CheckboxGroup`s, one for fruits and one for vegetables.
 * The two are grouped together in a single `Fieldset`, labeled by a legend.
 *
 * For screen reader accessibility, do not nest more than one level.
 */
export const Nesting: StoryObj = {
	render: function Template() {
		const [ fruitValue, setFruitValue ] = useState< string[] >( [] );
		const [ vegetableValue, setVegetableValue ] = useState< string[] >(
			[]
		);

		return (
			<Fieldset.Root>
				<Fieldset.Legend>Favorite foods</Fieldset.Legend>

				<CheckboxGroup.Root
					value={ fruitValue }
					onValueChange={ ( newValue, event ) => {
						setFruitValue( newValue );
						// eslint-disable-next-line no-console
						console.log( newValue, event );
					} }
					allValues={ [ 'apple', 'orange', 'banana' ] }
				>
					<CheckboxControl parent value="fruit" label="Fruit" />
					<CheckboxGroup.NestedItems>
						<CheckboxControl value="apple" label="Apple" />
						<CheckboxControl value="orange" label="Orange" />
						<CheckboxControl value="banana" label="Banana" />
					</CheckboxGroup.NestedItems>
				</CheckboxGroup.Root>

				<CheckboxGroup.Root
					value={ vegetableValue }
					onValueChange={ ( newValue, event ) => {
						setVegetableValue( newValue );
						// eslint-disable-next-line no-console
						console.log( newValue, event );
					} }
					allValues={ [ 'carrot', 'broccoli', 'lettuce' ] }
				>
					<CheckboxControl
						parent
						value="vegetable"
						label="Vegetable"
					/>
					<CheckboxGroup.NestedItems>
						<CheckboxControl value="carrot" label="Carrot" />
						<CheckboxControl value="broccoli" label="Broccoli" />
						<CheckboxControl value="lettuce" label="Lettuce" />
					</CheckboxGroup.NestedItems>
				</CheckboxGroup.Root>
			</Fieldset.Root>
		);
	},
};
