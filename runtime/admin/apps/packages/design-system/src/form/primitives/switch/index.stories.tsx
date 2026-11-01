import type { Meta, StoryObj } from '@storybook/react-vite';
import { Switch } from '../../..';

const meta: Meta< typeof Switch > = {
	title: 'Design System/Form/Primitives/Switch',
	component: Switch,
};

export default meta;

type Story = StoryObj< typeof Switch >;

export const Default: Story = {
	args: {},
};

export const Checked: Story = {
	args: {
		defaultChecked: true,
	},
};

export const Disabled: Story = {
	args: {
		disabled: true,
	},
};

export const DisabledChecked: Story = {
	args: {
		defaultChecked: true,
		disabled: true,
	},
};
