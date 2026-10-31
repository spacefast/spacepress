import { __dangerousOptInToUnstableAPIsOnlyForCoreModules } from '@wordpress/private-apis';

type RawPrivateApis = ReturnType<
	typeof __dangerousOptInToUnstableAPIsOnlyForCoreModules
>;

export type PrivateApiToken< T > = {
	readonly __private_api_type__?: T;
};

const { lock: privateApisLock, unlock: privateApisUnlock } =
	__dangerousOptInToUnstableAPIsOnlyForCoreModules(
		'I acknowledge private features are not for use in themes or plugins and doing so will break in the next version of WordPress.',
		'@wordpress/edit-site'
	);

export const lock: < T >(
	object: PrivateApiToken< T >,
	privateData: T
) => void = privateApisLock as RawPrivateApis[ 'lock' ];

export const unlock: {
	< T >( object: PrivateApiToken< T > ): T;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fallback for non-typed private APIs should be any, not unknown.
	( object: unknown ): any;
} = privateApisUnlock as RawPrivateApis[ 'unlock' ];
