import { jsonResponse, errorResponse } from '../utils/response';
import { verifyFirebaseToken } from '../utils/firebase';
import { generateId, now } from '../utils/db';

interface GoogleAuthInput {
  idToken: string;
}

interface UserRow {
  id: string;
  email: string;
  google_uid: string;
  display_name: string | null;
  photo_url: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Handle Google OAuth authentication
 * POST /api/auth/google
 *
 * 1. Receive Firebase ID token from request body
 * 2. Verify token using Firebase verification
 * 3. Check if user exists by google_uid
 * 4. If not, create new user
 * 5. Return user data
 */
export async function handleGoogleAuth(
  db: D1Database,
  request: Request,
  projectId: string
): Promise<Response> {
  let body: GoogleAuthInput;

  try {
    body = (await request.json()) as GoogleAuthInput;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  // Validate idToken is provided
  if (!body.idToken || typeof body.idToken !== 'string') {
    return errorResponse('idToken is required');
  }

  // Verify the Firebase ID token
  const payload = await verifyFirebaseToken(body.idToken, projectId);

  if (!payload) {
    return errorResponse('Invalid or expired token', 401);
  }

  const googleUid = payload.sub;
  const email = payload.email || '';
  const displayName = payload.name || null;
  const photoUrl = payload.picture || null;

  // Check if user already exists by google_uid
  let user = await db
    .prepare('SELECT * FROM users WHERE google_uid = ?')
    .bind(googleUid)
    .first<UserRow>();

  const timestamp = now();

  if (user) {
    // User exists - update their profile info (in case it changed in Google)
    await db
      .prepare(
        'UPDATE users SET email = ?, display_name = ?, photo_url = ?, updated_at = ? WHERE id = ?'
      )
      .bind(email, displayName, photoUrl, timestamp, user.id)
      .run();

    // Return updated user data
    return jsonResponse({
      data: {
        user: {
          id: user.id,
          email,
          displayName,
          photoUrl,
        },
      },
    });
  }

  // Check if user exists by email (for migration from old accounts)
  const existingByEmail = await db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<UserRow>();

  if (existingByEmail) {
    // Link Google account to existing email account
    await db
      .prepare(
        'UPDATE users SET google_uid = ?, display_name = ?, photo_url = ?, updated_at = ? WHERE id = ?'
      )
      .bind(googleUid, displayName, photoUrl, timestamp, existingByEmail.id)
      .run();

    return jsonResponse({
      data: {
        user: {
          id: existingByEmail.id,
          email,
          displayName,
          photoUrl,
        },
      },
    });
  }

  // Create new user
  const userId = generateId();

  await db
    .prepare(
      'INSERT INTO users (id, email, google_uid, display_name, photo_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(userId, email, googleUid, displayName, photoUrl, timestamp, timestamp)
    .run();

  return jsonResponse(
    {
      data: {
        user: {
          id: userId,
          email,
          displayName,
          photoUrl,
        },
      },
    },
    201
  );
}
