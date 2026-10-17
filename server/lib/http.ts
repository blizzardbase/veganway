// Errors and validation shared by every router.
import { z } from 'zod';

export class HttpError extends Error {
  name = 'HttpError';
  constructor(public status: number, message: string, public code?: string, public field?: string) {
    super(message);
  }
}

export function fail(status: number, message: string, code?: string, field?: string): never {
  throw new HttpError(status, message, code, field);
}

/**
 * Parse untrusted input. A failure becomes a 400 whose message is the first issue's message,
 * so give every field a readable { error: '...' } in its schema. The failing path goes in "field".
 */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    fail(400, issue?.message ?? 'Please check what you entered.', 'invalid_input', issue?.path.join('.') || undefined);
  }
  return result.data;
}
