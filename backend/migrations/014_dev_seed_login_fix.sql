-- Fix dev seed accounts: password must match "Admin@123" (bcrypt) and allow login without email verification.
-- Hash generated with bcrypt cost 12 for password Admin@123

UPDATE users
SET
  password_hash = '$2a$12$iMn3Jyg8Dj7iElDIzRWLke6rVGRHN1iqDdkOyY0DwMDRIpcKQfjdm',
  email_verified = true
WHERE lower(email) = 'admin@acme.com';
