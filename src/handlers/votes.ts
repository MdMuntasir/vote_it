import { jsonResponse, errorResponse, notFound } from '../utils/response';
import { getPollById, getOptionById, checkDuplicateVote, castVote } from '../utils/db';

export interface VoteInput {
  option_id: string;
  fingerprint: string;
}

// POST /api/polls/:id/vote - Submit a vote
export async function handleVote(
  db: D1Database,
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
    body = await request.json() as VoteInput;
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

  // Check if poll exists
  const poll = await getPollById(db, pollId);
  if (!poll) {
    return notFound('Poll not found');
  }

  // Check if option exists and belongs to this poll
  const option = await getOptionById(db, body.option_id);
  if (!option) {
    return notFound('Option not found');
  }

  if (option.poll_id !== pollId) {
    return errorResponse('Option does not belong to this poll', 400);
  }

  // Check for duplicate vote (same poll + IP + fingerprint)
  const isDuplicate = await checkDuplicateVote(db, pollId, ipAddress, fingerprint);
  if (isDuplicate) {
    return errorResponse('You have already voted on this poll', 409);
  }

  // Cast the vote (insert vote + update counters atomically)
  const result = await castVote(db, pollId, body.option_id, ipAddress, fingerprint);

  return jsonResponse({
    data: {
      message: 'Vote recorded successfully',
      poll_id: pollId,
      option_id: body.option_id,
      new_vote_count: result.optionVoteCount,
      new_total_votes: result.pollTotalVotes,
    },
  }, 201);
}
