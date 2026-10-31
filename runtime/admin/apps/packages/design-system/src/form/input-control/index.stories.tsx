import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { plus, reset, seen, unseen } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { InputControl, InputLayout, Stack } from '../..';
import {
	WithPrefix,
	WithSuffixControl,
} from '../primitives/input/index.stories';

const meta: Meta< typeof InputControl > = {
	title: 'Design System/Form/InputControl',
	component: InputControl,
};
export default meta;

type Story = StoryObj< typeof InputControl >;

export const Default: Story = {
	args: {
		label: 'Label',
		description: 'This is the description.',
		placeholder: 'Placeholder',
	},
};

WithPrefix.args = {
	...WithPrefix.args,
	...Default.args,
};
WithSuffixControl.args = {
	...WithSuffixControl.args,
	...Default.args,
};
export { WithPrefix, WithSuffixControl };

export const Password: Story = {
	render: function Template( args ) {
		const [ show, setShow ] = useState( false );

		return (
			<InputControl
				{ ...args }
				type={ show ? 'text' : 'password' }
				suffix={
					<InputLayout.Slot padding="minimal">
						<IconButton
							label={ show ? 'Hide password' : 'Show password' }
							onClick={ () => setShow( ! show ) }
							icon={ show ? unseen : seen }
							size="small"
							variant="minimal"
						/>
					</InputLayout.Slot>
				}
			/>
		);
	},
	args: {
		...Default.args,
		defaultValue: 'password',
	},
};

export const Date: Story = {
	args: {
		...Default.args,
		type: 'date',
	},
};

export const Number: Story = {
	args: {
		...Default.args,
		type: 'number',
	},
};

export const NumberWithSteppers: Story = {
	render: function Template( args ) {
		const [ value, setValue ] = useState( 0 );

		return (
			<>
				<style>
					{ `
					  .my-number-with-steppers input[type='number'] {
							-moz-appearance: textfield;
					  }
						.my-number-with-steppers ::-webkit-inner-spin-button {
							appearance: none;
						}
					` }
				</style>
				<InputControl
					{ ...args }
					value={ value }
					onValueChange={ ( v ) => setValue( parseInt( v, 10 ) ) }
					className="my-number-with-steppers"
					suffix={
						<InputLayout.Slot padding="minimal">
							<Stack direction="row" gap={ 2 }>
								<IconButton
									label="Increment"
									icon={ plus }
									onClick={ () => setValue( value + 1 ) }
									size="small"
									variant="minimal"
								/>
								<IconButton
									label="Decrement"
									icon={ reset }
									onClick={ () => setValue( value - 1 ) }
									size="small"
									variant="minimal"
								/>
							</Stack>
						</InputLayout.Slot>
					}
				/>
			</>
		);
	},
	args: {
		...Default.args,
		type: 'number',
	},
};
