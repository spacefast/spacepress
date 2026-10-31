<?php

declare(strict_types=1);

namespace Zero\Wp;

/**
 * Core `/wp/v2/zero_*` (§4.8) for one Zero post type: core's posts controller, with Zero's access
 * rules ({@see CoreAccess}) on top of the capabilities it already checks.
 *
 * - Lists: a read rule that denies is 401/403; a filtering rule (or draft visibility) limits the
 *   query to the rows it covers, so pagination counts only those. `search` and `slug` can't probe a
 *   column hidden from the viewer.
 * - Items: a row the read rule filters out is 404, as on `/zero/v1`.
 * - Every response, in every context, drops the fields the viewer can't read.
 * - Creates and updates run in one transaction ({@see EditorSave}) that Zero's rules authorize on the
 *   save's own data before it commits; a refusal is Zero's 401/403 and nothing is saved.
 */
final class PostsController extends \WP_REST_Posts_Controller
{
    private string $collection;

    public function __construct($post_type)
    {
        parent::__construct($post_type);
        $this->collection = CoreAccess::collection($post_type) ?? throw new \LogicException("$post_type is not a Zero post type");
    }

    public function get_items_permissions_check($request)
    {
        return CoreAccess::readDenial($this->collection, CoreAccess::viewer())
            ?? CoreAccess::queryDenial($this->collection, $request, CoreAccess::viewer())
            ?? parent::get_items_permissions_check($request);
    }

    public function get_items($request)
    {
        $keys = CoreAccess::keys($this->collection, 'read', CoreAccess::viewer() ?? throw new \LogicException('checked'));
        if (!is_array($keys)) {
            return parent::get_items($request);
        }
        $allowed = array_map('intval', $keys);
        // Core maps the default empty `include` to post__in = [], which means no restriction.
        $limit = static function (array $args) use ($allowed): array {
            $in = !empty($args['post__in']) ? array_values(array_intersect($allowed, array_map('intval', (array) $args['post__in']))) : $allowed;

            return ['post__in' => $in === [] ? [0] : $in] + $args;
        };
        add_filter("rest_{$this->post_type}_query", $limit, PHP_INT_MAX);
        try {
            return parent::get_items($request);
        } finally {
            remove_filter("rest_{$this->post_type}_query", $limit, PHP_INT_MAX);
        }
    }

    public function get_item_permissions_check($request)
    {
        $viewer = CoreAccess::viewer();
        if (($denied = CoreAccess::readDenial($this->collection, $viewer)) !== null) {
            return $denied;
        }
        $post = $this->get_post($request['id']);
        if ($post instanceof \WP_Post && $post->post_status !== 'auto-draft' && $post->post_status !== 'trash'
            && !CoreAccess::covers($this->collection, 'read', $post->ID, $viewer)) {
            return new \WP_Error('rest_post_invalid_id', __('Invalid post ID.'), ['status' => 404]);
        }

        return parent::get_item_permissions_check($request);
    }

    public function check_read_permission($post)
    {
        return parent::check_read_permission($post) && current_user_can('read_post', $post->ID);
    }

    public function prepare_item_for_response($item, $request)
    {
        $response = parent::prepare_item_for_response($item, $request);

        $stored = Plugin::instance()?->db()->editorRow($this->collection, (int) $item->ID);

        return CoreAccess::strip($response, $this->collection, $stored, CoreAccess::viewer());
    }

    public function create_item($request)
    {
        return EditorSave::rest($this->collection, null, fn () => parent::create_item($request));
    }

    public function update_item($request)
    {
        $post = $this->get_post($request['id']);
        $postId = $post instanceof \WP_Post ? $post->ID : null;

        return EditorSave::rest($this->collection, $postId, fn () => parent::update_item($request));
    }
}
