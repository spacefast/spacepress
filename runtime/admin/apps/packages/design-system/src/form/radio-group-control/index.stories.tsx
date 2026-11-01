import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { RadioGroupControl } from '../..';

const meta: Meta< typeof RadioGroupControl > = {
	title: 'Design System/Form/RadioGroupControl',
	component: RadioGroupControl,
	argTypes: {
		onValueChange: { action: fn() },
	},
};
export default meta;

type Story = StoryObj< typeof RadioGroupControl >;

export const Default: Story = {
	args: {
		label: 'Label',
		items: [
			{
				label: 'Apple',
				value: 'apple',
				description: 'This is the description for the apple.',
			},
			{
				label: 'Banana',
				value: 'banana',
				description: 'This is the description for the banana.',
			},
		],
	},
};

export const WithDescription: Story = {
	args: {
		...Default.args,
		description: 'This is the description for the entire fieldset.',
	},
};

export const WithDisabledItem: Story = {
	args: {
		...Default.args,
		items: [
			{
				label: 'Apple',
				value: 'apple',
			},
			{
				label: 'Banana',
				value: 'banana',
				description: 'This item is disabled.',
				disabled: true,
			},
			{
				label: 'Orange',
				value: 'orange',
			},
		],
	},
};
