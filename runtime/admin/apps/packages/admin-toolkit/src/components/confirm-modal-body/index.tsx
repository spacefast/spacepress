import type { ActionModal } from '@first-admin/dataviews';
import {
	ConfirmRenderModal,
	type ConfirmRenderModalConfigProps,
} from './confirm-render-modal';

type ConfirmModalActionFields< Item > = Pick<
	ActionModal< Item >,
	| 'modalHeader'
	| 'RenderModal'
	| 'modalSize'
	| 'modalFocusOnMount'
	| 'hideModalHeader'
>;

type ConfirmModalActionOptions< Item > = Pick<
	ActionModal< Item >,
	'modalHeader'
> &
	ConfirmRenderModalConfigProps< Item >;

export default function createConfirmModal< Item >( {
	modalHeader,
	...confirmRenderModalProps
}: ConfirmModalActionOptions< Item > ): ConfirmModalActionFields< Item > {
	return {
		modalHeader,
		hideModalHeader: true,
		RenderModal: ( props ) => (
			<ConfirmRenderModal< Item >
				{ ...props }
				{ ...confirmRenderModalProps }
				modalHeader={
					typeof modalHeader === 'function'
						? modalHeader( props.items )
						: modalHeader
				}
			/>
		),
		modalSize: 'medium',
		modalFocusOnMount: 'firstContentElement',
	};
}
