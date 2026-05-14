/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const authPath = path.resolve(__dirname, '../src/routes/auth.js');
let source = fs.readFileSync(authPath, 'utf8');
let changed = false;

if (!source.includes('function validatePasswordStrength(password)')) {
  source = source.replace(
    'function signAccessToken(userId, orgId, role) {',
    `function validatePasswordStrength(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(value)) return 'Password must include at least one uppercase letter';
  if (!/[a-z]/.test(value)) return 'Password must include at least one lowercase letter';
  if (!/\\d/.test(value)) return 'Password must include at least one number';
  if (!/[^a-zA-Z0-9]/.test(value)) return 'Password must include at least one special character';
  return null;
}

function signAccessToken(userId, orgId, role) {`
  );
  changed = true;
}

if (source.includes("const verificationLink = `${origin.replace(/\\/$/, '')}/verify-email?token=${encodeURIComponent(verificationToken)}`;")) {
  source = source.replace(
    '    // Generate + store email verification token (24h) - optional, don\'t fail signup\n    try {\n      const verificationToken = randomToken(32);',
    '    // Generate + store email verification token (24h) - optional, don\'t fail signup\n    let verificationToken = null;\n    try {\n      verificationToken = randomToken(32);'
  );
  source = source.replace(
    "    const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';\n    const verificationLink = `${origin.replace(/\\/$/, '')}/verify-email?token=${encodeURIComponent(verificationToken)}`;\n\n    // Send verification email - don't fail signup if email fails\n    try {",
    "    const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';\n    const verificationLink = verificationToken\n      ? `${origin.replace(/\\/$/, '')}/verify-email?token=${encodeURIComponent(verificationToken)}`\n      : `${origin.replace(/\\/$/, '')}/signin`;\n\n    // Send verification email - don't fail signup if email fails\n    try {"
  );
  changed = true;
}

if (changed) {
  fs.writeFileSync(authPath, source);
  console.log('[patch-auth-signup] Applied auth signup compatibility fixes.');
} else {
  console.log('[patch-auth-signup] No auth signup patch needed.');
}
