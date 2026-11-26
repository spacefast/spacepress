import { useMemo } from 'react';
import {
	useWidgetTypes,
	type DashboardWidgetType,
	type RegisteredDashboardWidgetType,
} from '@spacepress-admin/dashboard';
import type {
	DashboardContext,
	DeclarativeWidgetDefinition,
} from '@spacepress-admin/boot';
import { BUILTIN_WIDGET_TYPES } from './builtins';
import { toDashboardWidgetType } from './declarative';
import './style.scss';

export { BUILTIN_WIDGET_TYPES } from './builtins';
export { toDashboardWidgetType } from './declarative';

/**
 * Combines module-registered widgets (from plugins), built-in SpacePress widgets,
 * and declarative `adminWidget()` definitions from the active app schema.
 */
export function useSpacePressWidgetTypes(
	registered: RegisteredDashboardWidgetType[],
	declarative: DeclarativeWidgetDefinition[] = [],
	context?: Partial<DashboardContext>
): DashboardWidgetType<unknown>[] {
	const moduleWidgets = useWidgetTypes(registered);

	return useMemo(() => {
		const builtins = BUILTIN_WIDGET_TYPES.filter(
			(w) => w.name !== 'sp/store-pulse' || context?.has_store !== false
		);
		const custom = declarative.map(toDashboardWidgetType);
		const seen = new Set<string>();
		const merged: DashboardWidgetType<unknown>[] = [];
		for (const list of [builtins, custom, moduleWidgets]) {
			for (const widget of list) {
				if (seen.has(widget.name)) continue;
				seen.add(widget.name);
				merged.push(widget);
			}
		}
		return merged;
	}, [moduleWidgets, declarative, context?.has_store]);
}
