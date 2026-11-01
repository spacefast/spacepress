import type { Meta, StoryObj } from '@storybook/react-vite';
import { Radio } from '../../..';

const meta: Meta< typeof Radio > = {
	title: 'Design System/Form/Primitives/Radio',
	component: Radio,
};
export default meta;

type Story = StoryObj< typeof Radio >;

export const Default: Story = {
	args: {
		value: 'apple',
	},
};

export const Disabled: Story = {
	args: {
		...Default.args,
		disabled: true,
	},
};
