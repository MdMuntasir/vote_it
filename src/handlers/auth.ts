import { jsonResponse, errorResponse } from '../utils/response';
import { hashPassword, verifyPassword } from '../utils/password';
import { createToken } from '../utils/jwt';
import { generateId, now } from '../utils/db';
import type { RegisterInput, LoginInput, UserRow } from '../types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export async function handleRegister(
  db: D1Database,
  request: Request,
  jwtSecret: string
): Promise<Response> {
  let body: RegisterInput;

  try {
    body = (await request.json()) as RegisterInput;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  // Validate email
  if (!body.email || typeof body.email !== 'string') {
    return errorResponse('Email is required');
  }

  const email = body.email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return errorResponse('Invalid email format');
  }

  // Validate password
  if (!body.password || typeof body.password !== 'string') {
    return errorResponse('Password is required');
  }

  if (body.password.length < MIN_PASSWORD_LENGTH) {
    return errorResponse(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  // Check if email already exists
  const existingUser = await db
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (existingUser) {
    return errorResponse('Email already registered', 409);
  }

  // Create user
  const userId = generateId();
  const passwordHash = await hashPassword(body.password);
  const timestamp = now();

  await db
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
    )
    .bind(userId, email, passwordHash, timestamp)
    .run();

  // Generate JWT token
  const token = await createToken(userId, email, jwtSecret);

  return jsonResponse(
    {
      data: {
        user: { id: userId, email },
        token,
      },
    },
    201
  );
}

export async function handleLogin(
  db: D1Database,
  request: Request,
  jwtSecret: string
): Promise<Response> {
  let body: LoginInput;

  try {
    body = (await request.json()) as LoginInput;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  // Validate inputs
  if (!body.email || typeof body.email !== 'string') {
    return errorResponse('Email is required');
  }

  if (!body.password || typeof body.password !== 'string') {
    return errorResponse('Password is required');
  }

  const email = body.email.trim().toLowerCase();

  // Find user
  const user = await db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<UserRow>();

  if (!user) {
    return errorResponse('Invalid email or password', 401);
  }

  // Verify password
  const isValid = await verifyPassword(body.password, user.password_hash);
  if (!isValid) {
    return errorResponse('Invalid email or password', 401);
  }

  // Generate JWT token
  const token = await createToken(user.id, user.email, jwtSecret);

  return jsonResponse({
    data: {
      user: { id: user.id, email: user.email },
      token,
    },
  });
}
