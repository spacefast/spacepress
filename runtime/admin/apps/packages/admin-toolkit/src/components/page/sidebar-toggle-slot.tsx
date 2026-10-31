import type { ComponentType, ReactNode } from 'react';
import { createSlotFill } from '@wordpress/components';

export interface FillProps {
	children?: ReactNode;
}

export interface SlotProps {
	bubblesVirtually?: boolean;
	className?: string;
}

const slotFill = createSlotFill( 'SidebarToggle' ) as {
	Fill: ComponentType< FillProps >;
	Slot: ComponentType< SlotProps >;
};

export const SidebarToggleFill = slotFill.Fill;
export const SidebarToggleSlot = slotFill.Slot;
