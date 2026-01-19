import { createRoute, matchRoute } from './router';
import { jsonResponse, errorResponse, notFound, corsHeaders } from './utils/response';
import { handleGetPolls, handleGetPollById, handleCreatePoll, handleGetUserPolls, handleUpdatePoll, handleDeletePoll } from './handlers/polls';
import { handleVote } from './handlers/votes';
import { handleGoogleAuth } from './handlers/auth';
import { authenticate } from './middleware/auth';

// Export the Durable Object class
export { VoteEngine } from './durable-objects/VoteEngine';

export interface Env {
  DB: D1Database;
  FIREBASE_PROJECT_ID: string;
  VOTE_ENGINE: DurableObjectNamespace;
}

// Define routes
const routes = {
  // Auth routes
  googleAuth: createRoute('POST', '/api/auth/google'),
  // Poll routes
  getPolls: createRoute('GET', '/api/polls'),
  getUserPolls: createRoute('GET', '/api/polls/me'),
  getPollById: createRoute('GET', '/api/polls/:id'),
  createPoll: createRoute('POST', '/api/polls'),
  updatePoll: createRoute('PUT', '/api/polls/:id'),
  deletePoll: createRoute('DELETE', '/api/polls/:id'),
  vote: createRoute('POST', '/api/polls/:id/vote'),
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle preflight requests
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check endpoint
      if (path === '/api/health' && method === 'GET') {
        return jsonResponse({ status: 'ok', message: 'Vote System API is running' });
      }

      // Test database connection
      if (path === '/api/db-test' && method === 'GET') {
        const result = await env.DB.prepare('SELECT 1 as test').first();
        return jsonResponse({ status: 'ok', db: result });
      }

      let match;

      // POST /api/auth/google - Google OAuth authentication
      match = matchRoute(routes.googleAuth, method, path);
      if (match) {
        return await handleGoogleAuth(env.DB, request, env.FIREBASE_PROJECT_ID);
      }

      // GET /api/polls/me - Get user's polls (requires authentication)
      match = matchRoute(routes.getUserPolls, method, path);
      if (match) {
        const authResult = await authenticate(request, env.DB, env.FIREBASE_PROJECT_ID);
        if (!authResult.authenticated) {
          return authResult.response;
        }
        return await handleGetUserPolls(env.DB, authResult.user.id);
      }

      // GET /api/polls - List all polls (public)
      match = matchRoute(routes.getPolls, method, path);
      if (match) {
        return await handleGetPolls(env.DB);
      }

      // POST /api/polls - Create a poll (requires authentication)
      match = matchRoute(routes.createPoll, method, path);
      if (match) {
        const authResult = await authenticate(request, env.DB, env.FIREBASE_PROJECT_ID);
        if (!authResult.authenticated) {
          return authResult.response;
        }
        return await handleCreatePoll(env, request, authResult.user.id);
      }

      // PUT /api/polls/:id - Update a poll (requires authentication + ownership)
      match = matchRoute(routes.updatePoll, method, path);
      if (match) {
        const authResult = await authenticate(request, env.DB, env.FIREBASE_PROJECT_ID);
        if (!authResult.authenticated) {
          return authResult.response;
        }
        return await handleUpdatePoll(env, request, match.params.id, authResult.user.id);
      }

      // DELETE /api/polls/:id - Delete a poll (requires authentication + ownership)
      match = matchRoute(routes.deletePoll, method, path);
      if (match) {
        const authResult = await authenticate(request, env.DB, env.FIREBASE_PROJECT_ID);
        if (!authResult.authenticated) {
          return authResult.response;
        }
        return await handleDeletePoll(env, match.params.id, authResult.user.id);
      }

      // POST /api/polls/:id/vote - Submit a vote (public, but tracked)
      match = matchRoute(routes.vote, method, path);
      if (match) {
        return await handleVote(env, request, match.params.id);
      }

      // GET /api/polls/:id - Get single poll with options (public)
      match = matchRoute(routes.getPollById, method, path);
      if (match) {
        return await handleGetPollById(env, match.params.id);
      }

      // 404 for unmatched API routes
      if (path.startsWith('/api/')) {
        return notFound('Endpoint not found');
      }

      // Default response - API info
      return jsonResponse({
        message: 'Vote System API',
        version: '1.0.0',
        endpoints: {
          health: 'GET /api/health',
          dbTest: 'GET /api/db-test',
          googleAuth: 'POST /api/auth/google',
          listPolls: 'GET /api/polls',
          createPoll: 'POST /api/polls (auth required)',
          getPoll: 'GET /api/polls/:id',
          vote: 'POST /api/polls/:id/vote',
        },
      });
    } catch (error) {
      console.error('Error:', error);
      const message = error instanceof Error ? error.message : 'Internal Server Error';
      return errorResponse(message, 500);
    }
  },
};
