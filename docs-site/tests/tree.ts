import type { Page } from "@playwright/test";

/**
 * Clicks the row of the file tree that shows `path`. The tree draws only the rows in view and reuses
 * their elements for other files when it scrolls, so an element found before a scroll can show the
 * next file by the time a click reaches it. The row is brought into view, and clicked where it is
 * once it has held its place for three frames.
 */
export async function pick(page: Page, path: string): Promise<void> {
	const selector = `[role="treeitem"][data-item-path="${path}"]`;
	await page.locator(`.explorer ${selector}`).first().scrollIntoViewIfNeeded();
	const at = await page.evaluate(async (selector) => {
		const tree = document.querySelector(".explorer file-tree-container")!;
		const find = () => (tree.shadowRoot ?? tree).querySelector(selector)?.getBoundingClientRect();
		let box = find();
		let last = "";
		for (let same = 0; same < 3; ) {
			await new Promise(requestAnimationFrame);
			box = find();
			const now = box ? `${box.x},${box.y}` : "";
			same = now !== "" && now === last ? same + 1 : 0;
			last = now;
		}
		return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
	}, selector);
	await page.mouse.click(at.x, at.y);
}
