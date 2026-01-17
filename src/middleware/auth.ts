import { verifyToken } from '../utils/jwt';
import { errorResponse } from '../utils/response';
import type { JwtPayload } from '../types';

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export type AuthResult =
  | { authenticated: true; user: AuthenticatedUser }
  | { authenticated: false; response: Response };

export async function authenticate(
  request: Request,
  jwtSecret: string
): Promise<AuthResult> {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    return {
      authenticated: false,
      response: errorResponse('Authorization header required', 401),
    };
  }

  if (!authHeader.startsWith('Bearer ')) {
    return {
      authenticated: false,
      response: errorResponse('Invalid authorization format', 401),
    };
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token, jwtSecret);

  if (!payload) {
    return {
      authenticated: false,
      response: errorResponse('Invalid or expired token', 401),
    };
  }

  return {
    authenticated: true,
    user: {
      id: payload.sub,
      email: payload.email,
    },
  };
}
