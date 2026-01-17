import { jsonResponse, errorResponse, notFound } from '../utils/response';
import { getAllPolls, getPollWithOptions, createPoll, generateId } from '../utils/db';
import type { CreatePollInput } from '../types';

export async function handleGetPolls(db: D1Database): Promise<Response> {
  const polls = await getAllPolls(db);
  return jsonResponse({ data: polls });
}

export async function handleGetPollById(
  db: D1Database,
  pollId: string
): Promise<Response> {
  const poll = await getPollWithOptions(db, pollId);
  if (!poll) {
    return notFound('Poll not found');
  }
  return jsonResponse({ data: poll });
}

export async function handleCreatePoll(
  db: D1Database,
  request: Request
): Promise<Response> {
  let body: CreatePollInput;

  try {
    body = await request.json() as CreatePollInput;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  // Validate required fields
  if (!body.title || typeof body.title !== 'string') {
    return errorResponse('Title is required and must be a string');
  }

  if (!body.options || !Array.isArray(body.options)) {
    return errorResponse('Options must be an array');
  }

  if (body.options.length < 2) {
    return errorResponse('At least 2 options are required');
  }

  // Validate each option is a non-empty string
  for (const option of body.options) {
    if (typeof option !== 'string' || option.trim().length === 0) {
      return errorResponse('Each option must be a non-empty string');
    }
  }

  // Trim and clean inputs
  const title = body.title.trim();
  const description = body.description?.trim() || null;
  const options = body.options.map((o) => o.trim());

  if (title.length === 0) {
    return errorResponse('Title cannot be empty');
  }

  // For Phase 2, we use a placeholder user ID since auth isn't implemented yet
  const tempUserId = 'anonymous';

  const poll = await createPoll(db, title, description, options, tempUserId);
  return jsonResponse({ data: poll }, 201);
}
