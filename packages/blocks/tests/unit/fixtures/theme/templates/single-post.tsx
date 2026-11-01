import { PostContent, PostTitle } from "@spacefast/zero-blocks/theme";

/** A derived hierarchy form: single-<post_type>. */
export default function SinglePost() {
  return (
    <>
      <PostTitle level={1} />
      <PostContent />
    </>
  );
}
