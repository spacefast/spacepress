export type Submission = {
  id: string;
  name: string;
  email: string;
  message: string;
  createdAt: string;
  updatedAt: string;
};

export type SubmissionInput = {
  name: string;
  email: string;
  message: string;
};

export function cleanSubmission(input: SubmissionInput): SubmissionInput | null {
  const name = input.name.trim().slice(0, 120);
  const email = input.email.trim().slice(0, 200);
  const message = input.message.trim().slice(0, 2000);
  if (!name || !message || !email.includes("@")) return null;
  return { name, email, message };
}
