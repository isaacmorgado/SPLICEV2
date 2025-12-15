import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import type { VercelRequest } from '@vercel/node';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const TOKEN_EXPIRY = '1h'; // Short-lived access token
const REFRESH_TOKEN_EXPIRY = '30d'; // Long-lived refresh token

export interface JWTPayload {
  userId: string;
  email: string;
}

export interface RefreshTokenPayload extends JWTPayload {
  isRefreshToken: true;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

export async function createRefreshToken(payload: JWTPayload): Promise<string> {
  const refreshPayload: RefreshTokenPayload = {
    ...payload,
    isRefreshToken: true,
  };
  return new SignJWT({ ...refreshPayload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const typedPayload = payload as unknown as RefreshTokenPayload;

    // Ensure it's a refresh token
    if (!typedPayload.isRefreshToken) {
      return null;
    }

    return typedPayload;
  } catch {
    return null;
  }
}

export function getTokenExpiry(): Date {
  // Return expiry time for access token (1 hour from now)
  return new Date(Date.now() + 60 * 60 * 1000);
}

export function getTokenFromRequest(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

export async function authenticateRequest(req: VercelRequest): Promise<JWTPayload | null> {
  const token = getTokenFromRequest(req);
  if (!token) {
    return null;
  }
  return verifyToken(token);
}

export function unauthorizedResponse() {
  return {
    status: 401,
    body: { error: 'Unauthorized' },
  };
}

export function forbiddenResponse() {
  return {
    status: 403,
    body: { error: 'Forbidden' },
  };
}
