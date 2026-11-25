import './style.scss';

/**
 * Widget Loading Overlay Component
 *
 * Displays a pulsing gray overlay for widget loading states.
 * Should be used inside a container with `position: relative`.
 *
 * @example
 * ```tsx
 * import { WidgetLoadingOverlay } from '@spacepress-admin/dashboard';
 *
 * <WidgetLoadingOverlay />
 * ```
 */
export function WidgetLoadingOverlay() {
	return <div className="widget-loading-overlay" />;
}
