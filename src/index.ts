import { createRoute, matchRoute } from './router';
import { jsonResponse, errorResponse, notFound, corsHeaders } from './utils/response';
import { handleGetPolls, handleGetPollById, handleCreatePoll } from './handlers/polls';
import { handleVote } from './handlers/votes';
import { handleRegister, handleLogin } from './handlers/auth';
import { authenticate } from './middleware/auth';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

// Define routes
const routes = {
  // Auth routes
  register: createRoute('POST', '/api/auth/register'),
  login: createRoute('POST', '/api/auth/login'),
  // Poll routes
  getPolls: createRoute('GET', '/api/polls'),
  getPollById: createRoute('GET', '/api/polls/:id'),
  createPoll: createRoute('POST', '/api/polls'),
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

      // Auth routes (public)
      match = matchRoute(routes.register, method, path);
      if (match) {
        return await handleRegister(env.DB, request, env.JWT_SECRET);
      }

      match = matchRoute(routes.login, method, path);
      if (match) {
        return await handleLogin(env.DB, request, env.JWT_SECRET);
      }

      // GET /api/polls - List all polls (public)
      match = matchRoute(routes.getPolls, method, path);
      if (match) {
        return await handleGetPolls(env.DB);
      }

      // POST /api/polls - Create a poll (requires authentication)
      match = matchRoute(routes.createPoll, method, path);
      if (match) {
        const authResult = await authenticate(request, env.JWT_SECRET);
        if (!authResult.authenticated) {
          return authResult.response;
        }
        return await handleCreatePoll(env.DB, request, authResult.user.id);
      }

      // POST /api/polls/:id/vote - Submit a vote (public, but tracked)
      match = matchRoute(routes.vote, method, path);
      if (match) {
        return await handleVote(env.DB, request, match.params.id);
      }

      // GET /api/polls/:id - Get single poll with options (public)
      match = matchRoute(routes.getPollById, method, path);
      if (match) {
        return await handleGetPollById(env.DB, match.params.id);
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
          register: 'POST /api/auth/register',
          login: 'POST /api/auth/login',
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
