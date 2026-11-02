import './media-api';
export { default as init } from './components/app';
export {
	updateMenuItem,
	setNudges,
	registerModal,
	unregisterModal,
	setDashboardContext,
	unregisterSiteHubHelpMenuItem,
} from './api';
export { store } from './store';
export { siteConfig } from './site';
export type {
	StoreSelectors,
	Nudge,
	EntityDependency,
	RegisteredModal,
} from './store/types';
import './view-transitions.scss';
