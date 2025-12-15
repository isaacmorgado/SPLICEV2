import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createUser, getUserByEmail, createSubscription } from '../_lib/db';
import { hashPassword, createToken, createRefreshToken, getTokenExpiry } from '../_lib/auth';
import { createCustomer } from '../_lib/stripe';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const user = await createUser(email, passwordHash);

    // Create Stripe customer
    const stripeCustomer = await createCustomer(email, user.id);

    // Create free subscription
    await createSubscription(user.id);

    // Generate JWT tokens
    const tokenPayload = {
      userId: user.id,
      email: user.email,
    };
    const token = await createToken(tokenPayload);
    const refreshToken = await createRefreshToken(tokenPayload);
    const expiresAt = getTokenExpiry();

    return res.status(201).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
      },
      token,
      refreshToken,
      expiresAt: expiresAt.toISOString(),
      stripeCustomerId: stripeCustomer.id,
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
