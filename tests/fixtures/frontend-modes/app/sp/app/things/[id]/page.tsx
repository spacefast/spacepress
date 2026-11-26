import type { PageProps } from "spacepress/server/app";

// A page with parameters and no metadata anywhere: no code Page, so WordPress's main query found
// nothing at this address; the page is still a 200 titled with the site's name.
export default function Thing({ params }: PageProps<"things/[id]">) {
  return <h1 className="thing">Thing {params.id}</h1>;
}
