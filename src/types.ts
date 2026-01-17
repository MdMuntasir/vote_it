// Database row types
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
}

export interface PollRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_at: number;
  total_votes: number;
}

export interface OptionRow {
  id: string;
  poll_id: string;
  text: string;
  vote_count: number;
}

export interface VoteRow {
  id: string;
  poll_id: string;
  option_id: string;
  user_id: string | null;
  ip_address: string;
  fingerprint: string;
  created_at: number;
}

// API response types
export interface PollWithOptions extends PollRow {
  options: OptionRow[];
}

export interface CreatePollInput {
  title: string;
  description?: string;
  options: string[];
}

export interface ApiError {
  error: string;
  details?: string;
}

export interface ApiSuccess<T> {
  data: T;
}

// Auth types
export interface RegisterInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
  };
  token: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}
