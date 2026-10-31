import type { Meta, StoryObj } from '@storybook/react-vite';
import { Link } from './index';

const meta: Meta< typeof Link > = {
	title: 'Design System/Link',
	component: Link,
};
export default meta;

type Story = StoryObj< typeof Link >;

export const Default: Story = {
	args: {
		children: 'Home',
		href: '/',
		tone: 'brand',
	},
};

export const OpenInNewTab: Story = {
	name: 'Open in new tab',
	args: {
		children: 'Learn more',
		href: 'https://wordpress.org/plugins/',
		openInNewTab: true,
		tone: 'brand',
	},
};

export const OpenInNewTabNeutral: Story = {
	name: 'Open in new tab (neutral tone)',
	args: {
		children: 'View documentation',
		href: 'https://developer.wordpress.org/',
		openInNewTab: true,
		tone: 'neutral',
	},
};
