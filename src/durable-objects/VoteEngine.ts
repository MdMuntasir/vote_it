/**
 * VoteEngine Durable Object
 *
 * Handles real-time vote counting with in-memory state.
 * Each poll gets its own Durable Object instance.
 * Syncs to D1 for persistence and backup.
 */

import type { OptionRow } from '../types';

interface VoteState {
  pollId: string;
  options: Map<string, { text: string; voteCount: number }>;
  totalVotes: number;
  voters: Set<string>; // Set of "ip:fingerprint" combinations
  initialized: boolean;
  dirty: boolean; // Whether there are unsaved changes
}

interface VoteRequest {
  action: 'vote' | 'getState' | 'init' | 'sync';
  pollId?: string;
  optionId?: string;
  ipAddress?: string;
  fingerprint?: string;
  userId?: string;
  // For initialization
  options?: Array<{ id: string; text: string; vote_count: number }>;
  totalVotes?: number;
  existingVoters?: string[];
}

interface VoteResponse {
  success: boolean;
  error?: string;
  data?: {
    optionVoteCount?: number;
    totalVotes?: number;
    options?: Array<{ id: string; text: string; vote_count: number }>;
    alreadyVoted?: boolean;
  };
}

export class VoteEngine implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private voteState: VoteState;
  private syncAlarm: boolean = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.voteState = {
      pollId: '',
      options: new Map(),
      totalVotes: 0,
      voters: new Set(),
      initialized: false,
      dirty: false,
    };

    // Load state from storage on construction
    this.state.blockConcurrencyWhile(async () => {
      await this.loadFromStorage();
    });
  }

  /**
   * Load persisted state from Durable Object storage
   */
  private async loadFromStorage(): Promise<void> {
    const stored = await this.state.storage.get<{
      pollId: string;
      options: [string, { text: string; voteCount: number }][];
      totalVotes: number;
      voters: string[];
      initialized: boolean;
    }>('voteState');

    if (stored) {
      this.voteState = {
        pollId: stored.pollId,
        options: new Map(stored.options),
        totalVotes: stored.totalVotes,
        voters: new Set(stored.voters),
        initialized: stored.initialized,
        dirty: false,
      };
    }
  }

  /**
   * Persist state to Durable Object storage
   */
  private async saveToStorage(): Promise<void> {
    await this.state.storage.put('voteState', {
      pollId: this.voteState.pollId,
      options: Array.from(this.voteState.options.entries()),
      totalVotes: this.voteState.totalVotes,
      voters: Array.from(this.voteState.voters),
      initialized: this.voteState.initialized,
    });
    this.voteState.dirty = false;
  }

  /**
   * Schedule a sync to D1 database
   */
  private async scheduleD1Sync(): Promise<void> {
    if (!this.syncAlarm) {
      // Schedule alarm for 5 seconds from now to batch syncs
      await this.state.storage.setAlarm(Date.now() + 5000);
      this.syncAlarm = true;
    }
  }

  /**
   * Handle alarm - sync to D1
   */
  async alarm(): Promise<void> {
    this.syncAlarm = false;
    await this.syncToD1();
  }

  /**
   * Sync current state to D1 database
   */
  private async syncToD1(): Promise<void> {
    if (!this.voteState.initialized || !this.voteState.pollId) {
      return;
    }

    try {
      // Update poll total votes
      await this.env.DB.prepare(
        'UPDATE polls SET total_votes = ? WHERE id = ?'
      )
        .bind(this.voteState.totalVotes, this.voteState.pollId)
        .run();

      // Update each option's vote count
      const batch = [];
      for (const [optionId, data] of this.voteState.options) {
        batch.push(
          this.env.DB.prepare('UPDATE options SET vote_count = ? WHERE id = ?')
            .bind(data.voteCount, optionId)
        );
      }

      if (batch.length > 0) {
        await this.env.DB.batch(batch);
      }
    } catch (error) {
      console.error('Failed to sync to D1:', error);
    }
  }

  /**
   * Handle incoming requests
   */
  async fetch(request: Request): Promise<Response> {
    try {
      const body = await request.json() as VoteRequest;
      let response: VoteResponse;

      switch (body.action) {
        case 'init':
          response = await this.handleInit(body);
          break;
        case 'vote':
          response = await this.handleVote(body);
          break;
        case 'getState':
          response = this.handleGetState();
          break;
        case 'sync':
          await this.syncToD1();
          response = { success: true };
          break;
        default:
          response = { success: false, error: 'Unknown action' };
      }

      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      return new Response(JSON.stringify({ success: false, error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Initialize the Durable Object with poll data
   */
  private async handleInit(body: VoteRequest): Promise<VoteResponse> {
    if (this.voteState.initialized) {
      return { success: true, data: { totalVotes: this.voteState.totalVotes } };
    }

    if (!body.pollId) {
      return { success: false, error: 'pollId is required for initialization' };
    }

    this.voteState.pollId = body.pollId;
    this.voteState.totalVotes = body.totalVotes || 0;
    this.voteState.initialized = true;

    if (body.options) {
      for (const opt of body.options) {
        this.voteState.options.set(opt.id, {
          text: opt.text,
          voteCount: opt.vote_count,
        });
      }
    }

    if (body.existingVoters) {
      for (const voter of body.existingVoters) {
        this.voteState.voters.add(voter);
      }
    }

    await this.saveToStorage();

    return { success: true, data: { totalVotes: this.voteState.totalVotes } };
  }

  /**
   * Handle a vote submission
   */
  private async handleVote(body: VoteRequest): Promise<VoteResponse> {
    if (!body.optionId || !body.ipAddress || !body.fingerprint) {
      return { success: false, error: 'Missing required fields' };
    }

    // Ensure pollId is set (use from request if state doesn't have it)
    if (!this.voteState.pollId && body.pollId) {
      this.voteState.pollId = body.pollId;
    }

    if (!this.voteState.pollId) {
      return { success: false, error: 'Poll ID not set - DO not initialized' };
    }

    // Check for duplicate vote
    const voterKey = `${body.ipAddress}:${body.fingerprint}`;
    if (this.voteState.voters.has(voterKey)) {
      return {
        success: false,
        error: 'You have already voted on this poll',
        data: { alreadyVoted: true },
      };
    }

    // Check if option exists
    const option = this.voteState.options.get(body.optionId);
    if (!option) {
      return { success: false, error: 'Option not found' };
    }

    // Record the vote
    option.voteCount += 1;
    this.voteState.totalVotes += 1;
    this.voteState.voters.add(voterKey);
    this.voteState.dirty = true;

    // Save to Durable Object storage immediately
    await this.saveToStorage();

    // Schedule D1 sync
    await this.scheduleD1Sync();

    // Also insert vote record into D1 for audit trail
    try {
      const voteId = crypto.randomUUID();
      const timestamp = Math.floor(Date.now() / 1000);
      await this.env.DB.prepare(
        'INSERT INTO votes (id, poll_id, option_id, user_id, ip_address, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(voteId, this.voteState.pollId, body.optionId, body.userId || null, body.ipAddress, body.fingerprint, timestamp)
        .run();
    } catch (error) {
      // Vote is already recorded in DO, D1 insert is for audit
      console.error('Failed to insert vote into D1:', error);
    }

    return {
      success: true,
      data: {
        optionVoteCount: option.voteCount,
        totalVotes: this.voteState.totalVotes,
      },
    };
  }

  /**
   * Get current poll state
   */
  private handleGetState(): VoteResponse {
    if (!this.voteState.initialized) {
      return { success: false, error: 'Not initialized' };
    }

    const options = Array.from(this.voteState.options.entries()).map(
      ([id, data]) => ({
        id,
        text: data.text,
        vote_count: data.voteCount,
      })
    );

    return {
      success: true,
      data: {
        totalVotes: this.voteState.totalVotes,
        options,
      },
    };
  }
}

// Environment interface - will be merged with main Env
interface Env {
  DB: D1Database;
}
