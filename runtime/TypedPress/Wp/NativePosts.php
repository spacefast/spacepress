<?php

declare(strict_types=1);

namespace TypedPress\Wp;

/**
 * WordPress's own posts as an app kind (`export const posts = wp.posts.extend(fields, { url })`).
 *
 * Core registers the `post` type and keeps it: its capabilities, the block editor, comments,
 * revisions, sticky posts, formats and feeds stay core's. TypedPress adds, on core's hooks:
 * - `register_post_type_args`: core's posts route answers through TypedPress's controller
 *   ({@see PostsController}), so the app's API, rules and field masks read the same rows the editor
 *   writes, and core's content abilities leave the type to the app's own abilities;
 * - the app's fields as post meta ({@see PostMeta}, registered with the app's other kinds);
 * - `post_link` builds each post's URL from the kind's `url` ({@see KindUrls});
 * - core's sitemap of posts leaves `post` out, since TypedPress's sitemap lists the kind ({@see Sitemap}).
 *
 * The app's access rules narrow core's capabilities and never widen them ({@see CoreAccess::mapMetaCap}).
 */
final class NativePosts
{
    public const TYPE = 'post';

    public static function register(\TypedPress\Schema $schema): void
    {
        if (self::kind($schema) === null) {
            return;
        }
        add_filter('register_post_type_args', static function (array $args, string $type): array {
            if ($type !== self::TYPE) {
                return $args;
            }
            return ['rest_controller_class' => PostsController::class, 'show_in_abilities' => false] + $args;
        }, PHP_INT_MAX, 2);
        // Core registered `post` before this plugin loaded (create_initial_post_types runs again on init 0,
        // and the filter above applies then): until then, its object already has the right controller.
        $object = get_post_type_object(self::TYPE);
        if ($object instanceof \WP_Post_Type) {
            $object->rest_controller_class = PostsController::class;
            $object->rest_controller = null;
            $object->show_in_abilities = false;
        }
        // A write through TypedPress's pipeline (its API, an action's `posts.update`) needs what core's
        // own screens need: the app's rule runs after this and can only narrow it.
        $kind = self::kind($schema);
        \TypedPress\Extensions::onWrite(static function (string $op, string $collection, array &$data, ?array $existing, ?\TypedPress\Viewer $viewer) use ($kind): void {
            if ($collection !== $kind || $viewer === null) {
                return;
            }
            $user = (int) ($viewer->user['id'] ?? 0);
            $id = (int) ($existing['id'] ?? 0);
            $publishing = ($data['status'] ?? null) === 'published' || ($data['status'] ?? null) === 'scheduled'
                || ($op === 'create' && !array_key_exists('status', $data));
            $allowed = match ($op) {
                'create' => user_can($user, 'edit_posts') && (!$publishing || user_can($user, 'publish_posts')),
                'update' => user_can($user, 'edit_post', $id) && (!$publishing || ($existing['status'] ?? null) === 'published' || user_can($user, 'publish_post', $id)),
                'delete' => user_can($user, 'delete_post', $id),
                default => true,
            };
            if (!$allowed) {
                throw \TypedPress\Access::deny($viewer->user, "$op $collection rows");
            }
        });
        add_filter('wp_sitemaps_post_types', static function (array $types): array {
            unset($types[self::TYPE]);
            return $types;
        });
    }

    /**
     * A deploy that turns the app's `posts` collection into WordPress's own posts: the collection's
     * items (post type `tp_posts`) become core posts in place. IDs, meta (the fields keep their
     * `tp_` keys), revisions, comments and uids stay as they were; the excerpt the collection kept as
     * the field `tp_excerpt` becomes the post's own excerpt, on each revision too, and comments open when
     * the kind has them on. Nothing is deleted.
     * Runs under the deploy's lock, after its migrations; a site with no such items does nothing.
     *
     * @return int how many items moved
     */
    public static function adopt(Plugin $plugin): int
    {
        $kind = self::kind($plugin->schema);
        if ($kind === null) {
            return 0;
        }
        $old = 'tp_' . $kind;
        foreach ($plugin->schema->collections() as $spec) {
            if (($spec['wp']['postType'] ?? null) === $old) {
                return 0; // another kind of the app still owns that type
            }
        }
        global $wpdb;
        $ids = array_map('intval', $wpdb->get_col($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_type = %s", $old)));
        if ($ids === []) {
            return 0;
        }
        // A collection without comments stored every item's comments as closed. Posts take comments
        // unless the kind turns them off, so the moved items get them; this can't tell an item an editor
        // closed by hand from one closed by the old default, and opens both.
        $open = ($plugin->schema->collection($kind)['comments'] ?? false) === true;
        foreach ($ids as $id) {
            $wpdb->update($wpdb->posts, ['post_type' => self::TYPE] + ($open ? ['comment_status' => 'open'] : []), ['ID' => $id]);
            $revisions = array_map('intval', $wpdb->get_col($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'revision' AND post_parent = %d", $id)));
            foreach ([$id, ...$revisions] as $post) {
                $excerpt = get_metadata('post', $post, 'tp_excerpt', true); // the revision's own, not its parent's
                if (is_string($excerpt) && $excerpt !== '' && (string) $wpdb->get_var($wpdb->prepare("SELECT post_excerpt FROM {$wpdb->posts} WHERE ID = %d", $post)) === '') {
                    $wpdb->update($wpdb->posts, ['post_excerpt' => $excerpt], ['ID' => $post]);
                }
                clean_post_cache($post);
            }
        }
        error_log(sprintf('TypedPress: %d %s items are now WordPress posts', count($ids), $old));

        return count($ids);
    }

    /** The app's name for WordPress's posts, when it exports them. */
    public static function kind(\TypedPress\Schema $schema): ?string
    {
        foreach ($schema->collections() as $name => $spec) {
            if ($spec['native'] ?? false) {
                return (string) $name;
            }
        }
        return null;
    }
}
