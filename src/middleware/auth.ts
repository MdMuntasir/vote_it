import { verifyFirebaseToken } from '../utils/firebase';
import { errorResponse } from '../utils/response';

export interface AuthenticatedUser {
  id: string;
  email: string;
  googleUid: string;
  displayName: string | null;
  photoUrl: string | null;
}

export type AuthResult =
  | { authenticated: true; user: AuthenticatedUser }
  | { authenticated: false; response: Response };

interface UserRow {
  id: string;
  email: string;
  google_uid: string;
  display_name: string | null;
  photo_url: string | null;
}

/**
 * Authenticate a request using Firebase ID token
 * Expects Authorization header with "Bearer <firebase-id-token>"
 */
export async function authenticate(
  request: Request,
  db: D1Database,
  projectId: string
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
  const payload = await verifyFirebaseToken(token, projectId);

  if (!payload) {
    return {
      authenticated: false,
      response: errorResponse('Invalid or expired token', 401),
    };
  }

  // Look up user by google_uid
  const user = await db
    .prepare('SELECT * FROM users WHERE google_uid = ?')
    .bind(payload.sub)
    .first<UserRow>();

  if (!user) {
    return {
      authenticated: false,
      response: errorResponse('User not found. Please sign in first.', 401),
    };
  }

  return {
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      googleUid: user.google_uid,
      displayName: user.display_name,
      photoUrl: user.photo_url,
    },
  };
}
