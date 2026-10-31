import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox } from '../../..';

const meta: Meta< typeof Checkbox > = {
	title: 'Design System/Form/Primitives/Checkbox',
	component: Checkbox,
};

export default meta;

type Story = StoryObj< typeof Checkbox >;

export const Default: Story = {
	args: {},
};

export const Checked: Story = {
	args: {
		defaultChecked: true,
	},
};

export const Indeterminate: Story = {
	args: {
		indeterminate: true,
	},
};

export const Disabled: Story = {
	args: {
		disabled: true,
	},
};

export const DisabledChecked: Story = {
	args: {
		disabled: true,
		defaultChecked: true,
	},
};
