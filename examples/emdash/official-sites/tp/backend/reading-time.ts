import type { PortableTextBlock } from "./host";

const WORDS_PER_MINUTE = 200;
const CJK_CHARACTERS_PER_MINUTE = 500;
const WHITESPACE_REGEX = /\s+/;
// Han, Hangul, Hiragana and Katakana: the code points \p{Script=Han|Hangul|Hiragana|Katakana}
// match in Unicode 17.0, as one explicit class. TypedPress refuses Unicode property escapes, because
// PHP's and the browser's regex engines carry different Unicode versions.
const CJK_CHARACTER_REGEX =
	/[\u{1100}-\u{11FF}\u{2E80}-\u{2E99}\u{2E9B}-\u{2EF3}\u{2F00}-\u{2FD5}\u{3005}\u{3007}\u{3021}-\u{3029}\u{302E}-\u{302F}\u{3038}-\u{303B}\u{3041}-\u{3096}\u{309D}-\u{309F}\u{30A1}-\u{30FA}\u{30FD}-\u{30FF}\u{3131}-\u{318E}\u{31F0}-\u{321E}\u{3260}-\u{327E}\u{32D0}-\u{32FE}\u{3300}-\u{3357}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{A960}-\u{A97C}\u{AC00}-\u{D7A3}\u{D7B0}-\u{D7C6}\u{D7CB}-\u{D7FB}\u{F900}-\u{FA6D}\u{FA70}-\u{FAD9}\u{FF66}-\u{FF6F}\u{FF71}-\u{FF9D}\u{FFA0}-\u{FFBE}\u{FFC2}-\u{FFC7}\u{FFCA}-\u{FFCF}\u{FFD2}-\u{FFD7}\u{FFDA}-\u{FFDC}\u{16FE2}-\u{16FE3}\u{16FF0}-\u{16FF6}\u{1AFF0}-\u{1AFF3}\u{1AFF5}-\u{1AFFB}\u{1AFFD}-\u{1AFFE}\u{1B000}-\u{1B122}\u{1B132}\u{1B150}-\u{1B152}\u{1B155}\u{1B164}-\u{1B167}\u{1F200}\u{20000}-\u{2A6DF}\u{2A700}-\u{2B81D}\u{2B820}-\u{2CEAD}\u{2CEB0}-\u{2EBE0}\u{2EBF0}-\u{2EE5D}\u{2F800}-\u{2FA1D}\u{30000}-\u{3134A}\u{31350}-\u{33479}]/gu;

type PortableTextSpan = {
	_type: string;
	text?: string;
};

type PortableTextTextBlock = PortableTextBlock & {
	_type: "block";
	children: PortableTextSpan[];
};

function isTextBlock(block: PortableTextBlock): block is PortableTextTextBlock {
	return block._type === "block" && Array.isArray(block.children);
}

function countWords(text: string): number {
	return text.split(WHITESPACE_REGEX).filter(Boolean).length;
}

function countCjkCharacters(text: string): number {
	return text.match(CJK_CHARACTER_REGEX)?.length ?? 0;
}

/**
 * Extract plain text from Portable Text blocks
 */
export function extractText(blocks: PortableTextBlock[] | undefined): string {
	if (!blocks || !Array.isArray(blocks)) return "";

	return blocks
		.filter(isTextBlock)
		.map((block) =>
			block.children
				.filter((child) => child._type === "span" && typeof child.text === "string")
				.map((span) => span.text)
				.join(""),
		)
		.join(" ");
}

/**
 * Calculate reading time in minutes from Portable Text content
 */
export function getReadingTime(content: PortableTextBlock[] | undefined): number {
	const text = extractText(content);
	const cjkCharacterCount = countCjkCharacters(text);
	const wordCount = countWords(text.replace(CJK_CHARACTER_REGEX, " "));
	const minutes = Math.ceil(
		wordCount / WORDS_PER_MINUTE + cjkCharacterCount / CJK_CHARACTERS_PER_MINUTE,
	);
	return Math.max(1, minutes);
}

/**
 * Format reading time for display
 */
export function formatReadingTime(minutes: number): string {
	return `${minutes} min read`;
}
