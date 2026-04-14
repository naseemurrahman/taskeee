-- TaskFlow Pro dev seed — all passwords: Admin@123 (bcrypt $2a$12$… verified)
INSERT INTO organizations (id, name, slug, plan)
VALUES ('00000000-0000-0000-0000-000000000001','Acme Corp','acme','business')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (id, org_id, email, password_hash, full_name, role) VALUES
('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',
 'admin@acme.com','$2a$12$iMn3Jyg8Dj7iElDIzRWLke6rVGRHN1iqDdkOyY0DwMDRIpcKQfjdm','Admin User','admin')
ON CONFLICT (org_id,email) DO NOTHING;

INSERT INTO task_categories (id, org_id, name, ai_threshold, color)
VALUES ('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000001','Maintenance',0.80,'#6C47D9')
ON CONFLICT DO NOTHING;

SELECT '✓ Seed complete' AS status,
  (SELECT COUNT(*) FROM users)  AS users,
  (SELECT COUNT(*) FROM tasks)  AS tasks;
