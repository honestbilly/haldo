import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { nanoid } from 'nanoid';
import pool from '../db.js';

const app = new Hono();

/**
 * Token-based auth flow:
 * 1. Manager generates a login token for a crew member (from dashboard or MCP)
 * 2. Token URL is sent via WhatsApp/text: https://haldo.app/login/abc123xyz
 * 3. Crew taps the link → permanent session cookie set
 * 4. They pick vessel/trip on the landing page (name is already known)
 * 5. Cookie lasts 365 days — they never have to log in again
 *
 * The token identifies WHO they are. The session page lets them pick WHERE and WHEN.
 */

// GET /login/:token — validate token, set auth cookie, redirect to session setup
app.get('/:token', async (c) => {
  const token = c.req.param('token');

  // Look up token
  const result = await pool.query(
    `SELECT at.*, cr.name as crew_name, cr.role as crew_role, cr.vessel as default_vessel
     FROM auth_tokens at
     JOIN crew cr ON at.crew_id = cr.id
     WHERE at.token = $1 AND at.revoked = FALSE AND cr.active = TRUE`,
    [token]
  );

  if (result.rows.length === 0) {
    return c.html(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Invalid Link — Haldo</title>
      <link rel="stylesheet" href="/public/style.css">
      </head><body>
      <div style="max-width:480px;margin:0 auto;padding:48px 16px;text-align:center">
        <h1 style="color:var(--danger);font-family:var(--font-heading)">Link Expired or Invalid</h1>
        <p style="color:var(--text-muted);margin-top:8px">This login link doesn't work. Ask your manager for a new one.</p>
        <a href="/" style="display:inline-block;margin-top:24px;color:var(--primary);text-decoration:none">Go to Haldo →</a>
      </div></body></html>`);
  }

  const row = result.rows[0];

  // Update last used
  await pool.query('UPDATE auth_tokens SET last_used_at = NOW() WHERE token = $1', [token]);

  // Set persistent auth cookie (365 days)
  const authData = {
    crew_id: row.crew_id,
    crew_name: row.crew_name,
    role: row.crew_role,
    default_vessel: row.default_vessel,
    auth_role: row.role, // crew | manager | admin
    token: token,
  };

  const encoded = Buffer.from(JSON.stringify(authData)).toString('base64');
  setCookie(c, 'haldo_auth', encoded, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    httpOnly: true,
    sameSite: 'Lax',
  });

  // Redirect to landing page (they still need to pick vessel/trip)
  return c.redirect('/');
});

/**
 * Generate a login token for a crew member.
 * Called from the manager dashboard or MCP.
 */
export async function generateToken(crewId: string, authRole: string = 'crew'): Promise<string> {
  const token = nanoid(16); // 16 chars — short enough for a URL
  await pool.query(
    'INSERT INTO auth_tokens (token, crew_id, role) VALUES ($1, $2, $3)',
    [token, crewId, authRole]
  );
  return token;
}

/**
 * Revoke a login token.
 */
export async function revokeToken(token: string): Promise<void> {
  await pool.query('UPDATE auth_tokens SET revoked = TRUE WHERE token = $1', [token]);
}

/**
 * Revoke all tokens for a crew member.
 */
export async function revokeAllTokens(crewId: string): Promise<void> {
  await pool.query('UPDATE auth_tokens SET revoked = TRUE WHERE crew_id = $1', [crewId]);
}

/**
 * Get auth data from cookie. Returns null if not authenticated.
 */
export function getAuth(c: any): { crew_id: string; crew_name: string; role: string; default_vessel: string; auth_role: string; token: string } | null {
  const raw = getCookie(c, 'haldo_auth');
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

export default app;
