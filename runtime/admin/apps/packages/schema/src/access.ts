import { ROLE_RANK, type AccessSummary, type ViewerSummary } from './types';

/**
 * Could this rule allow anything for the viewer? Mirrors the runtime's own "may allow" test used
 * for the menu: a role or `anyone`/`authenticated` is decided here; `rule`, `self` and `owner`
 * can only be answered per row, so they may. `false` never may.
 *
 * This is a courtesy for navigation, not the guard: the API applies the rule itself.
 */
export function mayAllow( rule: AccessSummary | undefined, viewer: ViewerSummary ): boolean {
	if ( rule === undefined || rule === false ) {
		return false;
	}
	switch ( rule ) {
		case 'anyone':
			return true;
		case 'authenticated':
			return viewer.id !== null;
		case 'rule':
		case 'self':
		case 'owner':
			return true;
		default: {
			const needed = ROLE_RANK.indexOf( rule );
			const has = viewer.role === null ? -1 : ROLE_RANK.indexOf( viewer.role );
			return needed !== -1 && has >= needed;
		}
	}
}

/**
 * The reason a button is greyed out before any request: `create` needs a rank the viewer lacks.
 * Returns null when the rule may allow (including per-row rules, where only the request decides).
 */
export function deniedBecause( rule: AccessSummary | undefined, viewer: ViewerSummary ): string | null {
	if ( mayAllow( rule, viewer ) ) {
		return null;
	}
	if ( rule === false || rule === undefined ) {
		return 'not allowed';
	}
	if ( rule === 'authenticated' ) {
		return 'sign in first';
	}
	return `needs ${ rule }`;
}
