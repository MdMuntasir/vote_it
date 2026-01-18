import { jsonResponse, errorResponse, notFound } from '../utils/response';
import { getPollById, getOptionById, getOptionsByPollId } from '../utils/db';
import type { Env } from '../index';

export interface VoteInput {
  option_id: string;
  fingerprint: string;
}

interface DOVoteResponse {
  success: boolean;
  error?: string;
  data?: {
    optionVoteCount?: number;
    totalVotes?: number;
    alreadyVoted?: boolean;
  };
}

/**
 * Get or initialize the Durable Object for a poll
 */
async function getVoteEngine(
  env: Env,
  pollId: string
): Promise<DurableObjectStub> {
  // Use poll ID as the Durable Object ID for consistent routing
  const id = env.VOTE_ENGINE.idFromName(pollId);
  return env.VOTE_ENGINE.get(id);
}

/**
 * Initialize the Durable Object with poll data from D1
 */
async function initializeVoteEngine(
  env: Env,
  stub: DurableObjectStub,
  pollId: string
): Promise<void> {
  // Get poll options from D1
  const options = await getOptionsByPollId(env.DB, pollId);
  const poll = await getPollById(env.DB, pollId);

  // Get existing voters to prevent duplicates
  const votersResult = await env.DB.prepare(
    'SELECT ip_address, fingerprint FROM votes WHERE poll_id = ?'
  )
    .bind(pollId)
    .all<{ ip_address: string; fingerprint: string }>();

  const existingVoters = votersResult.results.map(
    (v) => `${v.ip_address}:${v.fingerprint}`
  );

  // Initialize the Durable Object
  await stub.fetch('http://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'init',
      options: options.map((o) => ({
        id: o.id,
        text: o.text,
        vote_count: o.vote_count,
      })),
      totalVotes: poll?.total_votes || 0,
      existingVoters,
    }),
  });
}

// POST /api/polls/:id/vote - Submit a vote
export async function handleVote(
  env: Env,
  request: Request,
  pollId: string
): Promise<Response> {
  // Extract IP address from Cloudflare header (falls back for local dev)
  const ipAddress =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';

  // Parse request body
  let body: VoteInput;
  try {
    body = (await request.json()) as VoteInput;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  // Validate option_id
  if (!body.option_id || typeof body.option_id !== 'string') {
    return errorResponse('option_id is required');
  }

  // Validate fingerprint
  if (!body.fingerprint || typeof body.fingerprint !== 'string') {
    return errorResponse('fingerprint is required');
  }

  const fingerprint = body.fingerprint.trim();
  if (fingerprint.length === 0) {
    return errorResponse('fingerprint cannot be empty');
  }

  // Check if poll exists in D1
  const poll = await getPollById(env.DB, pollId);
  if (!poll) {
    return notFound('Poll not found');
  }

  // Check if option exists and belongs to this poll
  const option = await getOptionById(env.DB, body.option_id);
  if (!option) {
    return notFound('Option not found');
  }

  if (option.poll_id !== pollId) {
    return errorResponse('Option does not belong to this poll', 400);
  }

  // Get or initialize the Durable Object
  const stub = await getVoteEngine(env, pollId);

  // Initialize DO with D1 data (idempotent - will skip if already initialized)
  await initializeVoteEngine(env, stub, pollId);

  // Submit vote to Durable Object
  const doResponse = await stub.fetch('http://do/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'vote',
      optionId: body.option_id,
      ipAddress,
      fingerprint,
      userId: null, // Could be extracted from auth if needed
    }),
  });

  const result = (await doResponse.json()) as DOVoteResponse;

  if (!result.success) {
    if (result.data?.alreadyVoted) {
      return errorResponse('You have already voted on this poll', 409);
    }
    return errorResponse(result.error || 'Failed to record vote', 500);
  }

  return jsonResponse(
    {
      data: {
        message: 'Vote recorded successfully',
        poll_id: pollId,
        option_id: body.option_id,
        new_vote_count: result.data?.optionVoteCount,
        new_total_votes: result.data?.totalVotes,
      },
    },
    201
  );
}
