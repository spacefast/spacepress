import { __ } from '@wordpress/i18n';
import './style.scss';

interface TaxonomyTermsProps {
	termNames: string[];
}

function TaxonomyTerms( { termNames }: TaxonomyTermsProps ) {
	if ( ! termNames.length ) {
		return (
			<span className="taxonomy-terms-empty">
				{ /* translators: Em dash displayed when there is no content to show */ }
				{ __( '—', 'typedpress-admin' ) }
			</span>
		);
	}

	return (
		<span className="taxonomy-terms">
			{ termNames.map( ( name, index ) => (
				<span key={ name } className="taxonomy-term">
					{ name }
					{ index < termNames.length - 1 && <span>,&nbsp;</span> }
				</span>
			) ) }
		</span>
	);
}

export { TaxonomyTerms };
export default TaxonomyTerms;
