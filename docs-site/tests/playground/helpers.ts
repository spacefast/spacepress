// What both Playground tests need: public/files/ over HTTP for First's plugin zips, and a browser
// that keeps Playground's sign-in cookie.
import { createReadStream, existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";

import { site } from "../unit/helpers.ts";

const files = path.join(site, "public/files");

/** public/files/ over HTTP, for the blueprint's First plugin zips. */
export function serveFiles(): Promise<http.Server> {
	const server = http.createServer((request, response) => {
		const file = path.join(files, decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname).replace(/^\/files\//, ""));
		if (!file.startsWith(files + path.sep) || !existsSync(file)) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "content-type": file.endsWith(".zip") ? "application/zip" : "application/octet-stream" });
		createReadStream(file).pipe(response);
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** fetch with a cookie jar, following redirects: Playground signs the visitor in with a redirect. */
export function browser(base: string) {
	const cookies = new Map<string, string>();
	return async (pathname: string): Promise<{ status: number; body: string; url: string }> => {
		let url = new URL(pathname, base);
		for (let hop = 0; hop < 5; hop++) {
			const response = await fetch(url, { redirect: "manual", headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
			for (const header of response.headers.getSetCookie()) {
				const [pair] = header.split(";");
				const at = pair!.indexOf("=");
				cookies.set(pair!.slice(0, at), pair!.slice(at + 1));
			}
			const location = response.headers.get("location");
			if (response.status >= 300 && response.status < 400 && location) {
				await response.arrayBuffer();
				url = new URL(location, url);
				continue;
			}
			return { status: response.status, body: await response.text(), url: url.pathname };
		}
		throw new Error(`too many redirects from ${pathname}`);
	};
}
