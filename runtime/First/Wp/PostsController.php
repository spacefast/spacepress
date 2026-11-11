<?php

declare(strict_types=1);

namespace First\Wp;

/**
 * Core `/wp/v2/first_*` (§4.8) for one First post type: core's posts controller, with First's access
 * rules ({@see CoreAccess}) on top of the capabilities it already checks.
 *
 * - Lists: a read rule that denies is 401/403; a filtering rule (or draft visibility) limits the
 *   query to the rows it covers, so pagination counts only those. `search` and `slug` can't probe a
 *   column hidden from the viewer.
 * - Items: a row the read rule filters out is 404, as on `/first/v1`.
 * - Every response, in every context, drops the fields the viewer can't read.
 * - Creates and updates run in one transaction ({@see EditorSave}) that First's rules authorize on the
 *   save's own data before it commits; a refusal is First's 401/403 and nothing is saved.
 */
final class PostsController extends \WP_REST_Posts_Controller
{
    private string $collection;

    public function __construct($post_type)
    {
        parent::__construct($post_type);
        $this->collection = CoreAccess::collection($post_type) ?? throw new \LogicException("$post_type is not a First post type");
        $this->meta = new PostMeta($post_type, $this->collection);
    }

    /** First's query arguments (spec §3a), next to core's own; values as on the facade's `?where=`. */
    public function get_collection_params()
    {
        return parent::get_collection_params() + [
            'where' => ['description' => 'A First filter, as JSON: `{"seats":{"gte":10}}`.', 'type' => 'string'],
            'orderBy' => ['description' => 'First fields to sort by, comma-separated; `-field` sorts descending.', 'type' => 'string'],
            'with' => ['description' => 'Relations to attach under `with`: `author,comments` or a JSON object.', 'type' => 'string'],
        ];
    }

    public function get_items_permissions_check($request)
    {
        return $this->readRequest($request, fn () => CoreAccess::readDenial($this->collection, CoreAccess::viewer())
            ?? CoreAccess::queryDenial($this->collection, $request, CoreAccess::viewer())
            ?? parent::get_items_permissions_check($request));
    }

    public function get_items($request)
    {
        return $this->readRequest($request, fn () => $this->readItems($request));
    }

    private function readItems(\WP_REST_Request $request)
    {
        $viewer = CoreAccess::viewer() ?? throw new \LogicException('checked');
        try {
            $query = FirstQuery::keys($this->collection, $request, $viewer, searched: $searched);
        } catch (\First\HttpError $e) {
            return CoreAccess::error($e);
        }
        $keys = CoreAccess::keys($this->collection, 'read', $viewer);
        $keys = is_array($keys) ? array_map('intval', $keys) : null;
        if ($query !== null) {
            // The First query already ran as this viewer (read rule, draft visibility, field masks).
            $keys = $keys === null ? $query : array_values(array_intersect($query, $keys));
        }
        if ($keys === null) {
            return FirstQuery::attach($this->collection, $request, $viewer, parent::get_items($request));
        }
        // Core maps the default empty `include` to post__in = [], which means no restriction.
        $ordered = $query !== null && $request['orderBy'] !== null;
        // Rows First's query selected already passed its read rule and draft visibility: core's own
        // status filter (published only, for most viewers) must not drop them again.
        $statuses = $query !== null && !$request->has_param('status') ? ['post_status' => ['publish', 'future', 'draft', 'pending', 'private']] : [];
        $limit = static function (array $args) use ($keys, $ordered, $statuses, $searched): array {
            $in = !empty($args['post__in']) ? array_values(array_intersect($keys, array_map('intval', (array) $args['post__in']))) : $keys;
            $args = $searched ? FirstQuery::coreArgs($args) : $args;

            return ['post__in' => $in === [] ? [0] : $in] + ($ordered ? ['orderby' => 'post__in'] : []) + $statuses + $args;
        };
        add_filter("rest_{$this->post_type}_query", $limit, PHP_INT_MAX);
        try {
            return FirstQuery::attach($this->collection, $request, $viewer, parent::get_items($request));
        } finally {
            remove_filter("rest_{$this->post_type}_query", $limit, PHP_INT_MAX);
        }
    }

    public function get_item_permissions_check($request)
    {
        return $this->readRequest($request, fn () => $this->readItemPermissions($request));
    }

    private function readItemPermissions(\WP_REST_Request $request)
    {
        $viewer = CoreAccess::viewer();
        if (($denied = CoreAccess::readDenial($this->collection, $viewer)) !== null) {
            return $denied;
        }
        $post = $this->get_post($request['id']);
        if ($post instanceof \WP_Post && !empty($request->get_query_params()['password'])) {
            $native = parent::get_item_permissions_check($request);
            if (is_wp_error($native) && $native->get_error_code() === 'rest_post_incorrect_password') {
                // A wrong password must not reveal a row the collection's own rule conceals.
                $readable = $this->readRequest($request,
                    fn () => CoreAccess::covers($this->collection, 'read', $post->ID, $viewer),
                    $post->post_password,
                );
                if ($readable) {
                    return $native;
                }
            }
        }
        if ($post instanceof \WP_Post && $post->post_status !== 'auto-draft' && $post->post_status !== 'trash'
            && !CoreAccess::covers($this->collection, 'read', $post->ID, $viewer)) {
            return new \WP_Error('rest_post_invalid_id', __('Invalid post ID.'), ['status' => 404]);
        }

        return parent::get_item_permissions_check($request);
    }

    public function get_item($request)
    {
        return $this->readRequest($request, function () use ($request) {
            $viewer = CoreAccess::viewer();

            return $viewer === null ? parent::get_item($request) : FirstQuery::attach($this->collection, $request, $viewer, parent::get_item($request));
        });
    }

    private function readRequest(\WP_REST_Request $request, callable $read, ?string $passwordProof = null): mixed
    {
        $password = $passwordProof ?? $request['password'];
        $viewer = CoreAccess::viewer();
        $store = Plugin::instance()?->db()->store();
        if ($viewer === null || !$store instanceof CompositeStore) {
            return $read();
        }
        $password = in_array($request->get_method(), ['GET', 'HEAD'], true) && is_string($password) && $password !== '' ? $password : null;

        return $store->posts->withReadPassword($this->collection, $viewer, $password, $read);
    }

    public function check_read_permission($post)
    {
        return parent::check_read_permission($post) && current_user_can('read_post', $post->ID);
    }

    public function prepare_item_for_response($item, $request)
    {
        $stored = Plugin::instance()?->db()->editorRow($this->collection, (int) $item->ID);
        $response = $this->meta instanceof PostMeta ? $this->meta->with((int) $item->ID, $stored, fn () => parent::prepare_item_for_response($item, $request))
            : parent::prepare_item_for_response($item, $request);
        // For the facade's own dispatches, the stored title and content in the view context: under
        // First, reading a field is the read rule's and the field rule's question (strip() then drops
        // what's hidden), not edit capability. Core's own clients keep core's shape.
        if (Facade::dispatching() && $response instanceof \WP_REST_Response && is_array($data = $response->get_data()) && $stored !== null) {
            $spec = Plugin::instance()?->schema->collection($this->collection) ?? [];
            foreach (['title' => $spec['title'] ?? null, 'content' => $spec['content'] ?? null] as $field => $col) {
                if ($col !== null && is_array($data[$field] ?? null)) {
                    $data[$field]['raw'] = (string) ($stored[$col] ?? '');
                }
            }
            $response->set_data($data);
        }

        return CoreAccess::strip($response, $this->collection, $stored, CoreAccess::viewer());
    }

    /**
     * An update rule that is a function may refuse without data and allow this request's data: core's
     * `edit_post` (which also guards revisions and wp-admin) stays the strict answer, and only this
     * update is admitted when the rule, given the data it declares, may allow it. EditorSave then
     * authorizes what was actually saved, against the row as it was.
     */
    public function update_item_permissions_check($request)
    {
        $allowed = parent::update_item_permissions_check($request);
        if (!is_wp_error($allowed) || $allowed->get_error_code() !== 'rest_cannot_edit') {
            return $allowed;
        }
        $post = $this->get_post($request['id']);
        $viewer = CoreAccess::viewer();
        if (!$post instanceof \WP_Post || $viewer === null || $viewer->user === null || !in_array($post->post_status, ['publish', 'future', 'draft', 'pending', 'private'], true)
            || !CoreAccess::mayUpdateWith($this->collection, $post->ID, CoreAccess::incoming($this->collection, $request)[0], $viewer)) {
            return $allowed;
        }

        return true;
    }

    public function create_item($request)
    {
        return EditorSave::rest($this->collection, null, $request, fn () => $this->save($request, fn () => parent::create_item($request)));
    }

    /** A hook refusing the delete is the editor's 4xx with its message (§1.7), and nothing is deleted. */
    public function delete_item($request)
    {
        // Inside a transaction someone else opened, a refusal must abort it, not become a response.
        if (Plugin::instance()?->connection()->inTransaction()) {
            return parent::delete_item($request);
        }
        try {
            return parent::delete_item($request);
        } catch (\First\HttpError | \First\JsError $e) {
            $problem = \First\App::problem($e);

            return CoreAccess::error(new \First\HttpError($problem['status'], $problem['code'], $problem['detail'], $problem['pointer'] ?? null));
        }
    }

    public function update_item($request)
    {
        $post = $this->get_post($request['id']);
        $postId = $post instanceof \WP_Post ? $post->ID : null;

        return EditorSave::rest($this->collection, $postId, $request, fn () => $this->save($request, fn () => parent::update_item($request)));
    }

    private function save(\WP_REST_Request $request, callable $save): mixed
    {
        return $this->meta instanceof PostMeta ? $this->meta->saving($request, $save) : $save();
    }
}
