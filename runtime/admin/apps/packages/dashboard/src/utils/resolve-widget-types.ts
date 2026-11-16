import type {
	DashboardWidgetType,
	RegisteredDashboardWidgetType,
} from '../types';

export interface ResolveWidgetTypesOptions {
	/**
	 * When aborted, the function discards all results and
	 * returns an empty array. Note that this does NOT cancel
	 * in-flight `import()` calls — dynamic imports are not
	 * cancelable. The signal is checked after all imports
	 * settle.
	 */
	signal?: AbortSignal;
}

/**
 * Resolves registered widget types into fully-hydrated
 * `DashboardWidgetType` objects.
 *
 * For each entry, dynamically imports `widget_module`, validates
 * its default export, and merges it with the PHP registration
 * data.
 *
 * Individual failures are logged but never reject the promise.
 *
 * @param registered - Widget types registered from PHP.
 * @param options    - Optional settings.
 * @return Resolved widget types (failed loads filtered out).
 */
export async function resolveWidgetTypes(
	registered: RegisteredDashboardWidgetType[],
	options?: ResolveWidgetTypesOptions
): Promise< DashboardWidgetType< unknown >[] > {
	const results = await Promise.all(
		registered.map(
			async (
				entry
			): Promise< DashboardWidgetType< unknown > | null > => {
				try {
					const { widget_module: widgetModule, ...rest } = entry;

					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const importedModule = await import( widgetModule );

					if (
						! importedModule ||
						typeof importedModule !== 'object' ||
						! ( 'default' in importedModule )
					) {
						throw new Error(
							'Widget module does not export a default'
						);
					}

					// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Dynamic imports return `any`, we validate structure above
					return {
						...rest,
						// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-type-assertion -- Required for dynamic import
						...( importedModule.default as Partial<
							DashboardWidgetType< unknown >
						> ),
					} as DashboardWidgetType< unknown >;
				} catch ( error ) {
					// eslint-disable-next-line no-console
					console.error(
						`Failed to load widget module: ${ entry.widget_module }`,
						error
					);
					return null;
				}
			}
		)
	);

	if ( options?.signal?.aborted ) {
		return [];
	}

	return results.filter(
		( w ): w is DashboardWidgetType< unknown > => w !== null
	);
}
