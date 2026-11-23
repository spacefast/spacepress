import { get_option } from "php/wordpress";
import type { PageProps, StaticParams } from "spacepress/app";

export const prerender = true;

export async function staticParams(): Promise<StaticParams<"tags/[tag]">> {
  // The site's option `prebuilt_tags` can drop a value, as a data-driven list would.
  return ["field", "lab notes"].filter((tag) => !String(get_option("prebuilt_drop") ?? "").includes(tag)).map((tag) => ({ tag }));
}

export default function Tag({ params }: PageProps<"tags/[tag]">) {
  return <h1 className="tag">{params.tag}</h1>;
}
