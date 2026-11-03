export { default as Dashboard } from './components/dashboard';
export { WidgetLoadingOverlay } from './components/widget-loading-overlay';
export {
	useDashboardWidgetContext,
	useWidgetContext,
} from './components/widget-context';
export { useWidgetTypes } from './hooks/use-widget-types';
export type {
	DashboardWidgetContextValue,
	WidgetContextValue,
} from './components/widget-context';
export type { DashboardActionType } from './components/dashboard-actions';
export type {
	DashboardWidget,
	DashboardWidgetType,
	LayoutChangeContext,
	RegisteredDashboardWidgetType,
	WidgetRenderProps,
	WidgetErrorConfig,
} from './types';
