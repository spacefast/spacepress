import clsx from 'clsx';
import { forwardRef, Fragment } from 'react';
import { RadioGroup, Field, Fieldset, Radio } from '../primitives';
import type { RadioGroupControlProps } from './types';
import { Stack } from '../../stack';
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

export const RadioGroupControl = forwardRef<
	HTMLDivElement,
	RadioGroupControlProps
>( function RadioGroupControl(
	{ items, className, label, description, name, ...restProps },
	ref
) {
	return (
		<Field.Root
			name={ name }
			className={ clsx( styles.root, className ) }
			render={ <Fieldset.Root /> }
		>
			<Fieldset.Legend>{ label }</Fieldset.Legend>
			{ description && (
				<Fieldset.Description>{ description }</Fieldset.Description>
			) }
			<RadioGroup
				ref={ ref }
				render={ <Stack direction="column" gap={ 2 } /> }
				{ ...restProps }
			>
				{ items.map( ( item ) => (
					<Field.Item
						key={ item.value }
						render={ <Stack gap={ 2 } align="start" /> }
					>
						<div className={ styles[ 'radio-wrapper' ] }>
							{ /* The zero-width space allows to use the same line height for both
							the radio wrapper and the label, ensuring that the first line of the
							label and the radio are always vertically centered */ }
							&#8203;
							<Radio
								value={ item.value }
								disabled={ item.disabled }
								className={ styles.radio }
							/>
						</div>
						<TextContainer isStack={ !! item.description }>
							<Field.Label
								className={ clsx(
									fieldStyles.label,
									fieldStyles[ 'is-plain' ],
									styles.label
								) }
							>
								{ item.label }
							</Field.Label>
							{ item.description && (
								<Field.Description
									className={ fieldStyles.description }
								>
									{ item.description }
								</Field.Description>
							) }
						</TextContainer>
					</Field.Item>
				) ) }
			</RadioGroup>
		</Field.Root>
	);
} );
