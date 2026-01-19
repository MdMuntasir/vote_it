import type { PollRow, OptionRow, PollWithOptions, VoteRow } from '../types';

export function generateId(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export async function getAllPolls(db: D1Database): Promise<PollRow[]> {
  const result = await db
    .prepare('SELECT * FROM polls ORDER BY total_votes DESC, created_at DESC')
    .all<PollRow>();
  return result.results;
}

export async function getAllPollsWithOptions(db: D1Database): Promise<PollWithOptions[]> {
  const polls = await getAllPolls(db);

  if (polls.length === 0) {
    return [];
  }

  // Get all options for all polls in one query
  const pollIds = polls.map(p => p.id);
  const placeholders = pollIds.map(() => '?').join(',');
  const options = await db
    .prepare(`SELECT * FROM options WHERE poll_id IN (${placeholders}) ORDER BY id`)
    .bind(...pollIds)
    .all<OptionRow>();

  // Group options by poll_id
  const optionsByPollId = new Map<string, OptionRow[]>();
  for (const option of options.results) {
    const existing = optionsByPollId.get(option.poll_id) || [];
    existing.push(option);
    optionsByPollId.set(option.poll_id, existing);
  }

  // Combine polls with their options
  return polls.map(poll => ({
    ...poll,
    options: optionsByPollId.get(poll.id) || [],
  }));
}

export async function getPollById(
  db: D1Database,
  pollId: string
): Promise<PollRow | null> {
  return await db
    .prepare('SELECT * FROM polls WHERE id = ?')
    .bind(pollId)
    .first<PollRow>();
}

export async function getOptionsByPollId(
  db: D1Database,
  pollId: string
): Promise<OptionRow[]> {
  const result = await db
    .prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY id')
    .bind(pollId)
    .all<OptionRow>();
  return result.results;
}

export async function getPollWithOptions(
  db: D1Database,
  pollId: string
): Promise<PollWithOptions | null> {
  const poll = await getPollById(db, pollId);
  if (!poll) return null;

  const options = await getOptionsByPollId(db, pollId);
  return { ...poll, options };
}

export async function createPoll(
  db: D1Database,
  title: string,
  description: string | null,
  options: string[],
  userId: string
): Promise<PollWithOptions> {
  const pollId = generateId();
  const timestamp = now();

  // Insert poll
  await db
    .prepare(
      'INSERT INTO polls (id, user_id, title, description, created_at, total_votes) VALUES (?, ?, ?, ?, ?, 0)'
    )
    .bind(pollId, userId, title, description, timestamp)
    .run();

  // Insert options
  const optionRows: OptionRow[] = [];
  for (const text of options) {
    const optionId = generateId();
    await db
      .prepare(
        'INSERT INTO options (id, poll_id, text, vote_count) VALUES (?, ?, ?, 0)'
      )
      .bind(optionId, pollId, text)
      .run();
    optionRows.push({
      id: optionId,
      poll_id: pollId,
      text,
      vote_count: 0,
    });
  }

  return {
    id: pollId,
    user_id: userId,
    title,
    description,
    created_at: timestamp,
    total_votes: 0,
    options: optionRows,
  };
}

// Get option by ID
export async function getOptionById(
  db: D1Database,
  optionId: string
): Promise<OptionRow | null> {
  return await db
    .prepare('SELECT * FROM options WHERE id = ?')
    .bind(optionId)
    .first<OptionRow>();
}

// Check for duplicate vote (poll_id + ip_address + fingerprint)
export async function checkDuplicateVote(
  db: D1Database,
  pollId: string,
  ipAddress: string,
  fingerprint: string
): Promise<boolean> {
  const existing = await db
    .prepare(
      'SELECT id FROM votes WHERE poll_id = ? AND ip_address = ? AND fingerprint = ?'
    )
    .bind(pollId, ipAddress, fingerprint)
    .first();
  return existing !== null;
}

// Get polls by user ID
export async function getPollsByUserId(
  db: D1Database,
  userId: string
): Promise<PollRow[]> {
  const result = await db
    .prepare('SELECT * FROM polls WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<PollRow>();
  return result.results;
}

export async function getPollsByUserIdWithOptions(
  db: D1Database,
  userId: string
): Promise<PollWithOptions[]> {
  const polls = await getPollsByUserId(db, userId);

  if (polls.length === 0) {
    return [];
  }

  // Get all options for user's polls in one query
  const pollIds = polls.map(p => p.id);
  const placeholders = pollIds.map(() => '?').join(',');
  const options = await db
    .prepare(`SELECT * FROM options WHERE poll_id IN (${placeholders}) ORDER BY id`)
    .bind(...pollIds)
    .all<OptionRow>();

  // Group options by poll_id
  const optionsByPollId = new Map<string, OptionRow[]>();
  for (const option of options.results) {
    const existing = optionsByPollId.get(option.poll_id) || [];
    existing.push(option);
    optionsByPollId.set(option.poll_id, existing);
  }

  // Combine polls with their options
  return polls.map(poll => ({
    ...poll,
    options: optionsByPollId.get(poll.id) || [],
  }));
}

// Update poll title and description
export async function updatePoll(
  db: D1Database,
  pollId: string,
  title: string,
  description: string | null
): Promise<void> {
  await db
    .prepare('UPDATE polls SET title = ?, description = ? WHERE id = ?')
    .bind(title, description, pollId)
    .run();
}

// Delete poll and all related data (cascade)
export async function deletePoll(
  db: D1Database,
  pollId: string
): Promise<void> {
  // Delete in order: votes -> options -> poll
  await db.batch([
    db.prepare('DELETE FROM votes WHERE poll_id = ?').bind(pollId),
    db.prepare('DELETE FROM options WHERE poll_id = ?').bind(pollId),
    db.prepare('DELETE FROM polls WHERE id = ?').bind(pollId),
  ]);
}

// Cast a vote and update counters atomically
export async function castVote(
  db: D1Database,
  pollId: string,
  optionId: string,
  ipAddress: string,
  fingerprint: string,
  userId: string | null = null
): Promise<{ optionVoteCount: number; pollTotalVotes: number }> {
  const voteId = generateId();
  const timestamp = now();

  // Use a batch to ensure atomicity
  const statements = [
    // Insert the vote
    db
      .prepare(
        'INSERT INTO votes (id, poll_id, option_id, user_id, ip_address, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(voteId, pollId, optionId, userId, ipAddress, fingerprint, timestamp),
    // Increment option vote count
    db
      .prepare('UPDATE options SET vote_count = vote_count + 1 WHERE id = ?')
      .bind(optionId),
    // Increment poll total votes
    db
      .prepare('UPDATE polls SET total_votes = total_votes + 1 WHERE id = ?')
      .bind(pollId),
  ];

  await db.batch(statements);

  // Fetch updated counts
  const option = await db
    .prepare('SELECT vote_count FROM options WHERE id = ?')
    .bind(optionId)
    .first<{ vote_count: number }>();

  const poll = await db
    .prepare('SELECT total_votes FROM polls WHERE id = ?')
    .bind(pollId)
    .first<{ total_votes: number }>();

  return {
    optionVoteCount: option?.vote_count ?? 0,
    pollTotalVotes: poll?.total_votes ?? 0,
  };
}
