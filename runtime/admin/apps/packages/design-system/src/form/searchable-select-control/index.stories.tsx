import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SearchableSelectControl } from '../..';
import * as SearchableSelectStories from '../primitives/searchable-select/stories/index.stories';

const meta: Meta< typeof SearchableSelectControl > = {
	title: 'Design System/Form/SearchableSelectControl',
	component: SearchableSelectControl,
	subcomponents: {
		Item: SearchableSelectControl.Item,
	},
	argTypes: {
		onValueChange: { action: fn() },
	},
};

export default meta;

type Story = StoryObj< typeof SearchableSelectControl >;

const ITEMS_WITH_DISABLED = [
	{
		value: '1',
		label: 'Apple',
	},
	{
		value: '2',
		label: 'Banana',
		disabled: true,
	},
	{
		value: '3',
		label: 'Cherry',
	},
	{
		value: '4',
		label: 'Date',
	},
];

export const Default: Story = {
	...SearchableSelectStories.Default,
	args: {
		...SearchableSelectStories.Default.args,
		label: 'Label',
		description: 'This is a description.',
	},
};

export const WithDisabledOption: Story = {
	args: {
		...Default.args,
		items: ITEMS_WITH_DISABLED,
		defaultValue: ITEMS_WITH_DISABLED[ 0 ],
	},
};
export const Creatable: Story = {
	...SearchableSelectStories.Creatable,
	args: {
		...Default.args,
		...SearchableSelectStories.Creatable.args,
	},
};

export const WithCustomTriggerAndItems: Story = {
	...SearchableSelectStories.WithCustomTriggerAndItems,
	args: {
		...Default.args,
		...SearchableSelectStories.WithCustomTriggerAndItems.args,
	},
};

export const WithCustomEmptyContent: Story = {
	...SearchableSelectStories.WithCustomEmptyContent,
	args: {
		...Default.args,
		...SearchableSelectStories.WithCustomEmptyContent.args,
	},
};
