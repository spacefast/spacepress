// Runs first: files of one hook register in file-name order.
export default function (content: string): string {
  return content + "[a]";
}
