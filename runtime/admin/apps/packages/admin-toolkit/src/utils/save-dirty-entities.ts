import { store as coreStore } from '@wordpress/core-data';
import type { DataRegistry } from '@wordpress/data';

type SaveRegistry = Pick< DataRegistry, 'select' | 'dispatch' >;

export type DirtyEntityRecord = {
	kind: string;
	name: string;
	key: number | string | undefined;
};

export type BeforeSaveContext = {
	registry: SaveRegistry;
	dirtyEntityRecords: DirtyEntityRecord[];
};

export type BeforeSaveHandler = (
	context: BeforeSaveContext
) => Promise< void > | void;

type CoreSelect = {
	__experimentalGetDirtyEntityRecords: () => DirtyEntityRecord[];
};

type CoreDispatch = {
	saveEditedEntityRecord: (
		kind: string,
		name: string,
		key: number | string | undefined,
		options?: {
			throwOnError?: boolean;
		}
	) => Promise< unknown >;
};

type SaveDirtyEntitiesOptions = {
	registry: SaveRegistry;
	dirtyEntityRecords?: DirtyEntityRecord[];
};

const beforeSaveHandlersByRegistry = new WeakMap<
	SaveRegistry,
	Set< BeforeSaveHandler >
>();
const pendingSavesByRegistry = new WeakMap<
	SaveRegistry,
	Promise< PromiseSettledResult< unknown >[] >
>();

function getCoreSelect( registry: Pick< DataRegistry, 'select' > ): CoreSelect {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- WordPress core-data does not expose the selector surface needed for dirty entity saves.
	return registry.select( coreStore ) as unknown as CoreSelect;
}

function getCoreDispatch(
	registry: Pick< DataRegistry, 'dispatch' >
): CoreDispatch {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- WordPress core-data does not expose the dispatcher surface needed for dirty entity saves.
	return registry.dispatch( coreStore ) as unknown as CoreDispatch;
}

export function registerBeforeSaveHandler(
	registry: SaveRegistry,
	handler: BeforeSaveHandler
): () => void {
	const handlers =
		beforeSaveHandlersByRegistry.get( registry ) ??
		new Set< BeforeSaveHandler >();

	handlers.add( handler );
	beforeSaveHandlersByRegistry.set( registry, handlers );

	return () => {
		handlers.delete( handler );

		if ( handlers.size === 0 ) {
			beforeSaveHandlersByRegistry.delete( registry );
		}
	};
}

async function runBeforeSaveHandlers(
	context: BeforeSaveContext
): Promise< void > {
	const handlers = beforeSaveHandlersByRegistry.get( context.registry );

	if ( ! handlers ) {
		return;
	}

	for ( const handler of Array.from( handlers ) ) {
		await handler( context );
	}
}

async function getDirtyEntityRecordsAfterBeforeSave( {
	registry,
	dirtyEntityRecords,
}: SaveDirtyEntitiesOptions ): Promise< DirtyEntityRecord[] > {
	const coreSelect = getCoreSelect( registry );
	const currentDirtyEntityRecords =
		dirtyEntityRecords ?? coreSelect.__experimentalGetDirtyEntityRecords();

	await runBeforeSaveHandlers( {
		registry,
		dirtyEntityRecords: currentDirtyEntityRecords,
	} );

	return coreSelect.__experimentalGetDirtyEntityRecords();
}

async function runDirtyEntitySave( {
	registry,
	dirtyEntityRecords,
}: SaveDirtyEntitiesOptions ): Promise< PromiseSettledResult< unknown >[] > {
	const coreDispatch = getCoreDispatch( registry );
	const currentDirtyEntityRecords =
		await getDirtyEntityRecordsAfterBeforeSave( {
			registry,
			dirtyEntityRecords,
		} );

	return Promise.allSettled(
		currentDirtyEntityRecords.map( ( record ) =>
			coreDispatch.saveEditedEntityRecord(
				record.kind,
				record.name,
				record.key,
				{ throwOnError: true }
			)
		)
	);
}

function saveDirtyEntitiesInternal(
	options: SaveDirtyEntitiesOptions
): Promise< PromiseSettledResult< unknown >[] > {
	const existingSavePromise = pendingSavesByRegistry.get( options.registry );

	if ( existingSavePromise ) {
		return existingSavePromise;
	}

	const savePromise = runDirtyEntitySave( options );
	const trackedSavePromise = savePromise.finally( () => {
		if (
			pendingSavesByRegistry.get( options.registry ) ===
			trackedSavePromise
		) {
			pendingSavesByRegistry.delete( options.registry );
		}
	} );

	pendingSavesByRegistry.set( options.registry, trackedSavePromise );

	return trackedSavePromise;
}

/**
 * Saves all dirty entities after running registered `beforeSave` handlers and
 * returns the settled result for each entity save.
 *
 * Use this variant when callers need to inspect partial failures instead of
 * rejecting the entire flow.
 * @param options
 */
export async function saveDirtyEntitiesSettled(
	options: SaveDirtyEntitiesOptions
): Promise< PromiseSettledResult< unknown >[] > {
	return saveDirtyEntitiesInternal( options );
}

/**
 * Saves all dirty entities after running registered `beforeSave` handlers.
 *
 * Use this variant when any failed entity save should reject the whole flow.
 * @param options
 */
export async function saveDirtyEntities(
	options: SaveDirtyEntitiesOptions
): Promise< unknown[] > {
	const results = await saveDirtyEntitiesInternal( options );
	const rejectedResult = results.find(
		( result ): result is PromiseRejectedResult =>
			result.status === 'rejected'
	);

	if ( rejectedResult ) {
		throw rejectedResult.reason;
	}

	return results.reduce< unknown[] >( ( values, result ) => {
		if ( result.status === 'fulfilled' ) {
			values.push( result.value );
		}

		return values;
	}, [] );
}
