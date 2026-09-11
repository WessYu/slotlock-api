import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const keyLength = 64;
const scryptOptions = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

function deriveKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, scryptOptions, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey as Buffer);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt);

  return [
    'scrypt',
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encodedHash: string) {
  const [algorithm, saltValue, keyValue] = encodedHash.split('$');

  if (algorithm !== 'scrypt' || !saltValue || !keyValue) {
    return false;
  }

  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const expectedKey = Buffer.from(keyValue, 'base64url');
    const actualKey = await deriveKey(password, salt);

    return (
      expectedKey.length === actualKey.length
      && timingSafeEqual(expectedKey, actualKey)
    );
  } catch {
    return false;
  }
}
