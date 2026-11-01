import type { Meta, StoryObj } from '@storybook/react-vite';
import { CheckboxControl } from '../..';

const meta: Meta< typeof CheckboxControl > = {
	title: 'Design System/Form/CheckboxControl',
	component: CheckboxControl,
};
export default meta;

type Story = StoryObj< typeof CheckboxControl >;

export const Default: Story = {
	args: {
		label: 'Label',
	},
};

export const WithDescription: Story = {
	args: {
		...Default.args,
		description: 'This is the description.',
	},
};

export const WithLongLabel: Story = {
	args: {
		...Default.args,
		label: 'This is a long label that should wrap to the next line. This is a long label that should wrap to the next line. This is a long label that should wrap to the next line.',
	},
};
