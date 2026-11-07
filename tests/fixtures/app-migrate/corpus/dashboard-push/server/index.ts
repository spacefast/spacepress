import { capsule, endpoint, redirect, type EndpointRequest } from "@spacefast/zero/server";

declare const DASHBOARD_ORIGIN: string;

export function newRepoDestination(request: EndpointRequest, dashboardOrigin: string) {
  // Creation runs on the canonical dashboard so the browser can use its API
  // session and anonymous quota. A server fetch would share one quota for everyone.
  const destination = new URL("/push", dashboardOrigin);
  const teamId = request.query.get("teamId");
  if (teamId) destination.searchParams.set("teamId", teamId);
  return redirect(destination.href, {
    status: 303,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export default capsule({
  name: "SpacefastDashboard",
  endpoints: {
    newRepo: endpoint({ method: "GET", path: "/push/new-repo" }, (_ctx, request) =>
      newRepoDestination(request, DASHBOARD_ORIGIN),
    ),
  },
});
