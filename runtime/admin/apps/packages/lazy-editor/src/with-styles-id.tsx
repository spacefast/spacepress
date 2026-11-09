import { unlock } from '@first-admin/admin-toolkit';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { useStylesId } from './use-styles-id';

export function withStylesId< T >(
	Component: React.ComponentType< T >
): React.FC<
	Omit< T, 'stylesId' > & {
		postId?: string;
		postType?: string;
	}
> {
	return function WrappedComponent( props ) {
		const { postId, postType } = props;
		const templateId = useSelect(
			( select ) => {
				if ( ! postType || ! postId ) {
					return undefined;
				}
				if ( postType === 'wp_template' ) {
					return postId;
				}
				return unlock( select( coreStore ) ).getTemplateId(
					postType,
					postId
				);
			},
			[ postType, postId ]
		);

		const stylesId = useStylesId( { templateId } );

		return <Component { ...( props as T ) } stylesId={ stylesId } />;
	};
}
