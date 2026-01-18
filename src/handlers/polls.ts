import { jsonResponse, errorResponse, notFound } from '../utils/response';
import { getAllPolls, getPollWithOptions, createPoll } from '../utils/db';
import type { CreatePollInput, PollWithOptions } from '../types';
import type { Env } from '../index';

interface DOStateResponse {
  success: boolean;
  error?: string;
  data?: {
    totalVotes: number;
    options: Array<{ id: string; text: string; vote_count: number }>;
  };
}

/**
 * Get live vote counts from Durable Object if available
 */
async function getLiveVoteCounts(
  env: Env,
  pollId: string,
  fallbackPoll: PollWithOptions
): Promise<PollWithOptions> {
  try {
    const id = env.VOTE_ENGINE.idFromName(pollId);
    const stub = env.VOTE_ENGINE.get(id);

    const response = await stub.fetch('http://do/getState', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getState' }),
    });

    const result = (await response.json()) as DOStateResponse;

    if (result.success && result.data) {
      // Merge DO data with poll data
      return {
        ...fallbackPoll,
        total_votes: result.data.totalVotes,
        options: result.data.options.map((opt) => ({
          id: opt.id,
          poll_id: pollId,
          text: opt.text,
          vote_count: opt.vote_count,
        })),
      };
    }
  } catch (error) {
    // DO not initialized yet, fall back to D1 data
    console.log('DO not available, using D1 data:', error);
  }

  return fallbackPoll;
}

export async function handleGetPolls(db: D1Database): Promise<Response> {
  const polls = await getAllPolls(db);
  return jsonResponse({ data: polls });
}

export async function handleGetPollById(
  env: Env,
  pollId: string
): Promise<Response> {
  // First get from D1 as baseline
  const poll = await getPollWithOptions(env.DB, pollId);
  if (!poll) {
    return notFound('Poll not found');
  }

  // Try to get live vote counts from Durable Object
  const liveData = await getLiveVoteCounts(env, pollId, poll);

  return jsonResponse({ data: liveData });
}

export async function handleCreatePoll(
  env: Env,
  request: Request,
  userId: string
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

  // Create poll in D1 (source of truth for metadata)
  const poll = await createPoll(env.DB, title, description, options, userId);

  // Pre-initialize the Durable Object for this poll
  try {
    const id = env.VOTE_ENGINE.idFromName(poll.id);
    const stub = env.VOTE_ENGINE.get(id);

    await stub.fetch('http://do/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'init',
        options: poll.options.map((o) => ({
          id: o.id,
          text: o.text,
          vote_count: 0,
        })),
        totalVotes: 0,
        existingVoters: [],
      }),
    });
  } catch (error) {
    // Non-fatal - DO will be initialized on first vote
    console.error('Failed to pre-initialize DO:', error);
  }

  return jsonResponse({ data: poll }, 201);
}
