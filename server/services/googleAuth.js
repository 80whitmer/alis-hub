const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

/**
 * Single-user (Aaron's own aaron@go-alis.com) Google OAuth -- there is no
 * session/login layer anywhere else in alis-hub, so this mirrors the existing
 * pattern (server/services/alisApiClient.js) of one set of long-lived
 * credentials in server/.env rather than a per-user auth flow.
 *
 * Read-only calendar access only (calendar.readonly) -- alis-hub only needs
 * to pull events in, not create/modify them.
 */
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

const TOKEN_DIR = path.join(__dirname, '..', 'auth');
const TOKEN_PATH = path.join(TOKEN_DIR, 'google-tokens.json');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set in server/.env -- see server/services/googleAuth.js for setup`);
  }
  return value;
}

function buildOAuthClient() {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const redirectUri = requireEnv('GOOGLE_REDIRECT_URI');
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** The URL Aaron opens in his own browser to grant consent. */
function getAuthUrl() {
  const client = buildOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh token back
    prompt: 'consent',      // force the consent screen so a refresh token is reissued even on repeat auth
    scope: SCOPES,
  });
}

function saveTokens(tokens) {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
}

/** Exchanges a one-time auth code (from the OAuth callback) for tokens and persists them. */
async function exchangeCodeForTokens(code) {
  const client = buildOAuthClient();
  const { tokens } = await client.getToken(code);
  saveTokens(tokens);
  return tokens;
}

/**
 * Returns an OAuth2 client authorized with the stored refresh token.
 * Throws if the one-time consent flow (getAuthUrl -> exchangeCodeForTokens)
 * hasn't been completed yet.
 */
function getAuthorizedClient() {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error(
      'No stored Google tokens found. Visit /api/google/oauth/start in a browser (logged in as aaron@go-alis.com) to grant access first.'
    );
  }
  const client = buildOAuthClient();
  client.setCredentials(tokens);
  // Persist a refreshed access token so we're not re-hitting Google's token
  // endpoint more than necessary on every call.
  client.on('tokens', (newTokens) => {
    saveTokens({ ...tokens, ...newTokens });
  });
  return client;
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getAuthorizedClient,
  loadTokens,
};
