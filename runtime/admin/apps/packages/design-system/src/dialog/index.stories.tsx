import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps } from 'react';
import { Dialog, CheckboxControl } from '..';

const meta: Meta< typeof Dialog.Root > = {
	title: 'Design System/Dialog',
	component: Dialog.Root,
	subcomponents: {
		'Dialog.Trigger': Dialog.Trigger,
		'Dialog.Popup': Dialog.Popup,
		'Dialog.Header': Dialog.Header,
		'Dialog.Heading': Dialog.Heading,
		'Dialog.CloseIcon': Dialog.CloseIcon,
		'Dialog.Action': Dialog.Action,
		'Dialog.Footer': Dialog.Footer,
	},
	args: {
		title: 'Dialog Title',
	},
	parameters: {
		docs: {
			description: {
				component: `
When using the Dialog component, make sure to always include a visible close button, either \`Dialog.CloseIcon\` or a clear dismissing action button. If your dialog has a "Cancel" button in the footer, the close icon may be redundant and create confusion about what clicking "X" means.

Use \`Dialog.CloseIcon\` for informational dialogs where dismissing is safe and expected. For dialogs requiring explicit user choice (especially destructive actions), omit the close icon and rely on footer action buttons like "Cancel" and "Confirm" instead.
				`,
			},
		},
	},
};
export default meta;

type Story = StoryObj< typeof Dialog.Root >;

function DialogWithSize( {
	size,
}: Pick< ComponentProps< typeof Dialog.Popup >, 'size' > ) {
	return (
		<>
			<Dialog.Trigger>Open Dialog</Dialog.Trigger>
			<Dialog.Popup size={ size }>
				<Dialog.Header>
					<Dialog.Heading />
					<Dialog.CloseIcon />
				</Dialog.Header>
				<p>
					This dialog demonstrates best practices for informational
					dialogs. It includes a close icon because dismissing it is
					safe and expected.
				</p>
				<CheckboxControl label="Don't show this again" />
				<Dialog.Footer>
					<Dialog.Action>Got it</Dialog.Action>
				</Dialog.Footer>
			</Dialog.Popup>
		</>
	);
}

/**
 * An informational dialog with a close icon, where there is no ambiguity on
 * what happens when clicking the close icon.
 */
export const Default: Story = {
	args: {
		title: 'Welcome',
		children: <DialogWithSize />,
	},
};

export const SmallSize: Story = {
	...Default,
	args: {
		...Default.args,
		children: <DialogWithSize size="small" />,
	},
};

export const MediumSize: Story = {
	...Default,
	args: {
		...Default.args,
		children: <DialogWithSize size="medium" />,
	},
};

export const LargeSize: Story = {
	...Default,
	args: {
		...Default.args,
		children: <DialogWithSize size="large" />,
	},
};

/**
 * Popovers in Gutenberg are managed with explicit z-index values, which can create
 * situations where a dialog renders below another popover, when you want it to be rendered above.
 *
 * The `--wp-ui-dialog-z-index` CSS variable controls the z-index of both the
 * backdrop and the popup. It can be overridden globally by setting the variable
 * on `:root` or `body`. (This story doesn't actually demonstrate the feature
 * because it requires a global CSS rule.)
 */
export const WithCustomZIndex: Story = {
	...Default,
	name: 'With Custom z-index',
};
