import { v4 as uuidv4 } from 'uuid';
import type { DashboardWidget, DashboardWidgetType } from '../types';

/**
 * Default values for widget grid placement.
 */
const DEFAULT_WIDTH = 1;
const DEFAULT_HEIGHT = 2;
const DEFAULT_ORDER = 0;

/**
 * Creates a new dashboard widget instance from a widget type.
 *
 * @param widgetType        - The widget type to create an instance from.
 * @param initialAttributes - Optional initial attributes for the widget. If not provided, the example attributes from the widget type will be used.
 *
 * @return A new dashboard widget instance.
 */
export function createDashboardWidget< T >(
	widgetType: DashboardWidgetType< T >,
	initialAttributes?: T
): DashboardWidget< T > {
	const { defaults } = widgetType;

	return {
		uid: uuidv4(),
		type: widgetType.name,
		attributes: initialAttributes ?? widgetType.example,
		width: defaults?.width ?? DEFAULT_WIDTH,
		height: defaults?.height ?? DEFAULT_HEIGHT,
		order: defaults?.order ?? DEFAULT_ORDER,
	};
}
