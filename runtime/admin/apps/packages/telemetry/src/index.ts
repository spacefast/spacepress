/**
 * Inert telemetry shim.
 *
 * The vendored admin routes call the upstream telemetry package for usage
 * tracking. Spacefast does not collect that telemetry, and the upstream
 * transport targets infrastructure that does not exist here. The upstream
 * hooks are tracking-only (they never drive UI state — modal close handlers
 * record, they do not close), so a same-shaped no-op implementation is
 * behavior-preserving. If First ever grows its own product analytics, this is
 * the seam to implement.
 */

export type TrackProps = Record<string, unknown>;
export interface RecordOptions {
	transport?: string;
}
export type ModalCloseReason = string;
export type ViewChangeType = string;
export interface ViewChange {
	type: ViewChangeType;
	[key: string]: unknown;
}
export interface TelemetryConfig {
	[key: string]: unknown;
}
export interface DataViewTrackingContext {
	[key: string]: unknown;
}

const noop = (): void => {};

// Events
export const recordPageView: (...args: unknown[]) => void = noop;
export const recordTracksEvent: (...args: unknown[]) => void = noop;
export const recordButtonClick: (...args: unknown[]) => void = noop;
export const recordButtonSuccess: (...args: unknown[]) => void = noop;
export const recordButtonError: (...args: unknown[]) => void = noop;
export const recordLinkClick: (...args: unknown[]) => void = noop;
export const recordTabClick: (...args: unknown[]) => void = noop;
export const recordWidgetView: (...args: unknown[]) => void = noop;

// Hooks

/** The `record*` family as methods: callers write `track.buttonClick('save')`. */
export interface Tracker {
	buttonClick: (label: string, props?: TrackProps) => void;
	buttonSuccess: (label: string, props?: TrackProps) => void;
	buttonError: (label: string, error: unknown, props?: TrackProps) => void;
	linkClick: (label: string, props?: TrackProps) => void;
	tabClick: (fromTab: string, toTab: string, props?: TrackProps) => void;
	widgetView: (widget: string, props?: TrackProps) => void;
}

const inertTracker: Tracker = Object.freeze({
	buttonClick: noop,
	buttonSuccess: noop,
	buttonError: noop,
	linkClick: noop,
	tabClick: noop,
	widgetView: noop,
});

export function useTrack(): Tracker {
	return inertTracker;
}

export interface TrackedModal {
	trackOpenChange: (...args: unknown[]) => void;
	trackRequestClose: (...args: unknown[]) => void;
	trackClose: (reason: ModalCloseReason) => void;
	trackButtonClick: (label: string, props?: TrackProps) => void;
	trackButtonError: (label: string, error: unknown, props?: TrackProps) => void;
	trackLinkClick: (label: string, props?: TrackProps) => void;
}

const inertModal: TrackedModal = {
	trackOpenChange: noop,
	trackRequestClose: noop,
	trackClose: noop,
	trackButtonClick: noop,
	trackButtonError: noop,
	trackLinkClick: noop,
};

export function useTrackedModal(..._args: unknown[]): TrackedModal {
	return inertModal;
}

export interface TrackedDataView {
	resetView: (...args: unknown[]) => void;
	onViewChange: (...args: unknown[]) => void;
	listItemClick: (...args: unknown[]) => void;
	/** Identity: returns the actions untouched so behavior is unchanged. */
	withActionTracking: <T>(actions: T) => T;
}

const inertDataView: TrackedDataView = {
	resetView: noop,
	onViewChange: noop,
	listItemClick: noop,
	withActionTracking: (actions) => actions,
};

export function useTrackedDataView(..._args: unknown[]): TrackedDataView {
	return inertDataView;
}

export const usePageView: (...args: unknown[]) => void = noop;
export const useWidgetTracking: (...args: unknown[]) => void = noop;

export interface DashboardTracking {
	trackLayoutChange: (...args: unknown[]) => void;
}

const inertDashboardTracking: DashboardTracking = {
	trackLayoutChange: noop,
};

export function useDashboardTracking(..._args: unknown[]): DashboardTracking {
	return inertDashboardTracking;
}

// Transport / context / init
export const registerTransport: (...args: unknown[]) => void = noop;
export const setDefaultTransport: (...args: unknown[]) => void = noop;
export const setSurfaceArea: (...args: unknown[]) => void = noop;
export const init: (...args: unknown[]) => void = noop;

// Utils
export function serializeFilters(filters: unknown): string {
	try {
		return filters == null ? '' : JSON.stringify(filters);
	} catch {
		return '';
	}
}

export function normalizeLabel(label: unknown): string {
	return String(label ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

export function extractErrorCode(error: unknown): string {
	if (error && typeof error === 'object' && 'code' in error) {
		return String((error as { code: unknown }).code);
	}
	return 'unknown';
}
