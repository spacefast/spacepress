import type { Meta, StoryObj } from '@storybook/react-vite';
import { Radio, RadioGroup } from '../../..';

const meta: Meta< typeof RadioGroup > = {
	title: 'Design System/Form/Primitives/RadioGroup',
	component: RadioGroup,
};

export default meta;

type Story = StoryObj< typeof RadioGroup >;

export const Default: Story = {
	args: {
		children: (
			<>
				<Radio value="apple" />
				<Radio value="banana" />
				<Radio value="orange" />
			</>
		),
	},
};

export const WithCheckedItem: Story = {
	args: {
		children: <Radio value="apple" />,
		defaultValue: 'apple',
	},
};

export const Disabled: Story = {
	args: {
		children: (
			<>
				<Radio value="apple" />
				<Radio value="banana" disabled />
			</>
		),
		defaultValue: 'apple',
		disabled: true,
	},
};
