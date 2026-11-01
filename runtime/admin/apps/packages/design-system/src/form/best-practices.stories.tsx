import type { Meta, StoryObj } from '@storybook/react-vite';
import { Fieldset, Input, InputLayout, Stack } from '..';

const meta: Meta = {
	title: 'Design System/Form/Best Practices',
	tags: [ '!dev' ],
};
export default meta;

/**
 * When building a custom control with multiple primitives combined under a single visual label,
 * special care must be taken so that the underlying elements are accessibly labeled.
 *
 * In this example, the two inputs are grouped as part of a `fieldset`,
 * and the visual label is semantically a `legend`. Each input is also labeled with an `aria-label`,
 * so a screen reader user can understand the purpose of each input.
 */
export const LabelingComposedComponents: StoryObj = {
	render: function Template() {
		return (
			<Fieldset.Root>
				<Fieldset.Legend>Shipping weight</Fieldset.Legend>
				<Stack direction="row" gap={ 4 }>
					<Input
						aria-label="Pounds"
						type="number"
						suffix={
							<InputLayout.Slot aria-hidden>lb</InputLayout.Slot>
						}
					/>
					<Input
						aria-label="Ounces"
						type="number"
						suffix={
							<InputLayout.Slot aria-hidden>oz</InputLayout.Slot>
						}
					/>
				</Stack>
				<Fieldset.Description>
					Enter the total weight of your shipment.
				</Fieldset.Description>
			</Fieldset.Root>
		);
	},
};
