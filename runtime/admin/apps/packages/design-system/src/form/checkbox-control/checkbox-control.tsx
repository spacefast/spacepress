import clsx from 'clsx';
import { forwardRef, Fragment } from 'react';
import { Checkbox, Field } from '../primitives';
import { Stack } from '../../stack';
import type { CheckboxControlProps } from './types';
import fieldStyles from '../../utils/css/field.module.css';
import styles from './style.module.css';

const TextContainer = ( {
	isStack,
	...restProps
}: {
	isStack?: boolean;
} & React.PropsWithChildren ) =>
	isStack ? (
		<Stack direction="column" gap={ 1 } { ...restProps } />
	) : (
		<Fragment { ...restProps } />
	);

export const CheckboxControl: React.ForwardRefExoticComponent<
	CheckboxControlProps & React.RefAttributes< HTMLSpanElement >
> = forwardRef( function CheckboxControl(
	{ label, description, className, name, ...checkboxProps },
	ref
) {
	const hasDescription = !! description;

	return (
		<Field.Root name={ name } className={ clsx( styles.root, className ) }>
			<Field.Item render={ <Stack gap={ 2 } align="start" /> }>
				<div className={ styles[ 'checkbox-wrapper' ] }>
					{ /* The zero-width space allows to use the same line height for both
						the checkbox wrapper and the label, ensuring that the first line of the
						label and the checkbox are always vertically centered */ }
					&#8203;
					<Checkbox
						ref={ ref }
						className={ styles.checkbox }
						{ ...checkboxProps }
					/>
				</div>
				<TextContainer isStack={ hasDescription }>
					<Field.Label
						className={ clsx(
							fieldStyles.label,
							fieldStyles[ 'is-plain' ],
							styles.label
						) }
					>
						{ label }
					</Field.Label>
					{ hasDescription && (
						<Field.Description
							className={ fieldStyles.description }
						>
							{ description }
						</Field.Description>
					) }
				</TextContainer>
			</Field.Item>
		</Field.Root>
	);
} );
