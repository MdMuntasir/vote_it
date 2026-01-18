/**
 * Firebase ID Token Verification for Cloudflare Workers
 * Uses Web Crypto API to verify RS256 signed tokens
 */

const GOOGLE_PUBLIC_KEYS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export interface FirebaseTokenPayload {
  iss: string;
  aud: string;
  auth_time: number;
  user_id: string;
  sub: string;
  iat: number;
  exp: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  firebase: {
    identities: Record<string, string[]>;
    sign_in_provider: string;
  };
}

interface GooglePublicKeys {
  keys: Record<string, string>;
  expiresAt: number;
}

// Cache for Google's public keys
let cachedKeys: GooglePublicKeys | null = null;

/**
 * Fetch Google's public keys for Firebase token verification
 * Keys are cached based on the Cache-Control header
 */
async function getGooglePublicKeys(): Promise<Record<string, string>> {
  const now = Date.now();

  // Return cached keys if still valid
  if (cachedKeys && cachedKeys.expiresAt > now) {
    return cachedKeys.keys;
  }

  const response = await fetch(GOOGLE_PUBLIC_KEYS_URL);
  if (!response.ok) {
    throw new Error('Failed to fetch Google public keys');
  }

  const keys = (await response.json()) as Record<string, string>;

  // Parse Cache-Control header to determine expiry
  const cacheControl = response.headers.get('Cache-Control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;

  cachedKeys = {
    keys,
    expiresAt: now + maxAge * 1000,
  };

  return keys;
}

/**
 * Convert a PEM formatted public key to a CryptoKey
 */
async function pemToCryptoKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and convert to binary
  const pemContents = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  // Import as X.509 certificate and extract public key
  // For Firebase, we need to extract the public key from the certificate
  // The certificate is in X.509 format, we need to parse it
  return await crypto.subtle.importKey(
    'spki',
    extractPublicKeyFromCert(binaryDer),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

/**
 * Extract the SubjectPublicKeyInfo from an X.509 certificate
 * This is a simplified parser for the specific certificate format used by Google
 */
function extractPublicKeyFromCert(certDer: Uint8Array): ArrayBuffer {
  // Parse the ASN.1 structure to find the SubjectPublicKeyInfo
  // The structure is: SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
  // tbsCertificate contains: version, serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo, ...

  let offset = 0;

  // Skip outer SEQUENCE tag and length
  offset += getAsn1Length(certDer, offset).offset;

  // Skip tbsCertificate SEQUENCE tag
  if (certDer[offset] !== 0x30) throw new Error('Invalid certificate format');
  offset++;
  const tbsLength = getAsn1Length(certDer, offset);
  offset = tbsLength.offset;

  // Skip version (context-specific tag [0])
  if (certDer[offset] === 0xa0) {
    offset++;
    const versionLen = getAsn1Length(certDer, offset);
    offset = versionLen.offset + versionLen.length;
  }

  // Skip serialNumber (INTEGER)
  if (certDer[offset] !== 0x02) throw new Error('Invalid certificate format');
  offset++;
  const serialLen = getAsn1Length(certDer, offset);
  offset = serialLen.offset + serialLen.length;

  // Skip signature algorithm (SEQUENCE)
  if (certDer[offset] !== 0x30) throw new Error('Invalid certificate format');
  offset++;
  const sigAlgLen = getAsn1Length(certDer, offset);
  offset = sigAlgLen.offset + sigAlgLen.length;

  // Skip issuer (SEQUENCE)
  if (certDer[offset] !== 0x30) throw new Error('Invalid certificate format');
  offset++;
  const issuerLen = getAsn1Length(certDer, offset);
  offset = issuerLen.offset + issuerLen.length;

  // Skip validity (SEQUENCE)
  if (certDer[offset] !== 0x30) throw new Error('Invalid certificate format');
  offset++;
  const validityLen = getAsn1Length(certDer, offset);
  offset = validityLen.offset + validityLen.length;

  // Skip subject (SEQUENCE)
  if (certDer[offset] !== 0x30) throw new Error('Invalid certificate format');
  offset++;
  const subjectLen = getAsn1Length(certDer, offset);
  offset = subjectLen.offset + subjectLen.length;

  // Now we're at subjectPublicKeyInfo (SEQUENCE)
  if (certDer[offset] !== 0x30) throw new Error('Invalid certificate format');
  const spkiStart = offset;
  offset++;
  const spkiLen = getAsn1Length(certDer, offset);
  const spkiEnd = spkiLen.offset + spkiLen.length;

  return certDer.slice(spkiStart, spkiEnd).buffer;
}

/**
 * Parse ASN.1 length encoding
 */
function getAsn1Length(
  data: Uint8Array,
  offset: number
): { length: number; offset: number } {
  const firstByte = data[offset];

  if (firstByte < 0x80) {
    // Short form: length is directly encoded
    return { length: firstByte, offset: offset + 1 };
  }

  // Long form: first byte indicates number of length bytes
  const numLengthBytes = firstByte & 0x7f;
  let length = 0;

  for (let i = 0; i < numLengthBytes; i++) {
    length = (length << 8) | data[offset + 1 + i];
  }

  return { length, offset: offset + 1 + numLengthBytes };
}

/**
 * Base64URL decode a string
 */
function base64UrlDecode(str: string): Uint8Array {
  // Add padding if necessary
  const padded = str + '==='.slice(0, (4 - (str.length % 4)) % 4);
  // Convert base64url to base64
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  // Decode
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Verify a Firebase ID token
 * @param token - The Firebase ID token to verify
 * @param projectId - The Firebase project ID
 * @returns The decoded token payload if valid, null otherwise
 */
export async function verifyFirebaseToken(
  token: string,
  projectId: string
): Promise<FirebaseTokenPayload | null> {
  try {
    // Split the token into parts
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // Decode header to get key ID
    const headerJson = new TextDecoder().decode(base64UrlDecode(headerB64));
    const header = JSON.parse(headerJson) as { alg: string; kid: string };

    // Verify algorithm
    if (header.alg !== 'RS256') {
      return null;
    }

    // Get the public key for this key ID
    const publicKeys = await getGooglePublicKeys();
    const publicKeyPem = publicKeys[header.kid];

    if (!publicKeyPem) {
      return null;
    }

    // Convert PEM to CryptoKey
    const publicKey = await pemToCryptoKey(publicKeyPem);

    // Verify signature
    const signatureInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlDecode(signatureB64);

    const isValid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      signature,
      signatureInput
    );

    if (!isValid) {
      return null;
    }

    // Decode and validate payload
    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as FirebaseTokenPayload;

    const now = Math.floor(Date.now() / 1000);

    // Validate issuer
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
      return null;
    }

    // Validate audience
    if (payload.aud !== projectId) {
      return null;
    }

    // Validate expiration
    if (payload.exp <= now) {
      return null;
    }

    // Validate issued at
    if (payload.iat > now) {
      return null;
    }

    // Validate subject (Firebase UID)
    if (!payload.sub || typeof payload.sub !== 'string') {
      return null;
    }

    return payload;
  } catch (error) {
    console.error('Error verifying Firebase token:', error);
    return null;
  }
}
