/**
 * Environment Configuration
 *
 * For local development, edit these values directly.
 * For production (Cloudflare Pages), this file will be replaced
 * by Cloudflare Pages Functions or you can use _headers to inject values.
 *
 * Alternatively, configure these via Cloudflare Pages dashboard:
 * Settings > Environment variables
 */
window.ENV = {
  // API URL - Your Cloudflare Workers API endpoint
  // Local dev: http://localhost:8787/api
  // Production: https://vote-system-api.<your-subdomain>.workers.dev/api
  API_URL: 'http://localhost:8787/api',

  // Firebase Configuration
  // Get these from Firebase Console > Project Settings
  FIREBASE_API_KEY: 'YOUR_API_KEY',
  FIREBASE_AUTH_DOMAIN: 'your-project.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'your-project-id',
};
