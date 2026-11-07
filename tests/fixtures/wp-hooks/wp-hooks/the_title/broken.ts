// Throws: WordPress gets the title it passed in, and the error is logged.
export default function (title: string, postId: number): string {
  if (postId > 0) throw new Error("broken title filter");
  return title;
}
