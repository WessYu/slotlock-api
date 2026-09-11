import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export type AuthRole = 'USER' | 'ADMIN';

interface AccessTokenPayload {
  iss: 'slotlock-api';
  aud: 'slotlock-api';
  sub: string;
  role: AuthRole;
  type: 'access';
  iat: number;
  exp: number;
}

const accessTokenTtlSeconds = 15 * 60;
export const refreshTokenTtlMs = 30 * 24 * 60 * 60 * 1000;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes.');
  }

  return secret;
}

export function assertAuthConfig() {
  getJwtSecret();
}

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(unsignedToken: string) {
  return createHmac('sha256', getJwtSecret())
    .update(unsignedToken)
    .digest('base64url');
}

export function signAccessToken(userId: string, role: AuthRole) {
  const now = Math.floor(Date.now() / 1000);

  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    iss: 'slotlock-api',
    aud: 'slotlock-api',
    sub: userId,
    role,
    type: 'access',
    iat: now,
    exp: now + accessTokenTtlSeconds,
  } satisfies AccessTokenPayload);

  const unsignedToken = `${header}.${payload}`;

  return {
    token: `${unsignedToken}.${sign(unsignedToken)}`,
    expiresInSeconds: accessTokenTtlSeconds,
  };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const parts = token.split('.');

  if (parts.length !== 3) {
    throw new Error('INVALID_ACCESS_TOKEN');
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const unsignedToken = `${headerPart}.${payloadPart}`;

  const expectedSignature = Buffer.from(sign(unsignedToken));
  const receivedSignature = Buffer.from(signaturePart);

  if (
    expectedSignature.length !== receivedSignature.length
    || !timingSafeEqual(expectedSignature, receivedSignature)
  ) {
    throw new Error('INVALID_ACCESS_TOKEN');
  }

  let payload: Partial<AccessTokenPayload>;

  try {
    payload = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString('utf8'),
    ) as Partial<AccessTokenPayload>;
  } catch {
    throw new Error('INVALID_ACCESS_TOKEN');
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    payload.iss !== 'slotlock-api'
    || payload.aud !== 'slotlock-api'
    || payload.type !== 'access'
    || typeof payload.sub !== 'string'
    || (payload.role !== 'USER' && payload.role !== 'ADMIN')
    || typeof payload.exp !== 'number'
    || payload.exp <= now
  ) {
    throw new Error('INVALID_ACCESS_TOKEN');
  }

  return payload as AccessTokenPayload;
}

export function createRefreshToken() {
  const token = `slr_${randomBytes(32).toString('base64url')}`;

  return {
    token,
    tokenHash: hashRefreshToken(token),
  };
}

export function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
