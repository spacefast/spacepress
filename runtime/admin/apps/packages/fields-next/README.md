# Fields

This package provides a dedicated package to track extensions to WordPress fields required by SpacePress Admin.

So far we've adding only media fields that don't yet exist in Core for the `attachment` post type.

## Media

When adding a new media field that needs to be sortable by `orderby` the corresponding enum will need to be added to the REST API collection params via the `sp_admin_rest_attachment_collection_params` filter.

See lib/api.php in this project.
