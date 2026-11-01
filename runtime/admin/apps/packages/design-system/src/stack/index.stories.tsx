import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stack } from './index';

const meta: Meta< typeof Stack > = {
	title: 'Design System/Stack',
	component: Stack,
};
export default meta;

const Box = ( { variant }: { variant?: 'large' } ) => (
	<div
		style={ {
			background: '#ccc',
			width: variant === 'large' ? '150px' : '100px',
			height: variant === 'large' ? '150px' : '100px',
		} }
	></div>
);

type Story = StoryObj< typeof Stack >;

export const Default: Story = {
	args: {
		children: (
			<>
				<Box />
				<Box variant="large" />
				<Box />
				<Box />
				<Box variant="large" />
				<Box />
			</>
		),
	},
	argTypes: {
		gap: {
			control: {
				type: 'number',
			},
			table: {
				type: { summary: 'number | string' },
			},
		},
		align: {
			options: [
				'center',
				'end',
				'flex-end',
				'flex-start',
				'start',
				'baseline',
				'stretch',
			],
			table: {
				type: {
					summary:
						'"center" | "end" | "flex-end" | "flex-start" | "start" | "baseline" | "stretch"',
				},
			},
		},
		justify: {
			options: [
				'space-around',
				'space-between',
				'space-evenly',
				'stretch',
				'center',
				'end',
				'flex-end',
				'flex-start',
				'start',
				'left',
				'right',
			],
			table: {
				type: {
					summary:
						'"space-around" | "space-between" | "space-evenly" | "stretch" | "center" | "end" | "flex-end" | "flex-start" | "start"',
				},
			},
		},
		wrap: {
			options: [ 'wrap' ],
			table: {
				type: { summary: '"wrap"' },
			},
		},
	},
};

export const Nested: Story = {
	...Default,
	args: {
		gap: 2,
		align: 'center',
		justify: 'center',
		children: (
			<>
				<Box variant="large" />
				<Stack>
					<Box />
					<Box />
				</Stack>
				<Box variant="large" />
				<Stack gap={ 0 }>
					<Box />
					<Box />
				</Stack>
				<Box variant="large" />
			</>
		),
	},
};
