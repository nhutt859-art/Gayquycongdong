-- ============================================================
--  GÂY QUỸ CỘNG ĐỒNG + AI — SCHEMA POSTGRESQL
--  Bám theo file "Usecase Database.docx" (16 bảng)
--  Chạy bằng: npm run db:setup
--  LƯU Ý: file này DROP và tạo lại toàn bộ bảng trong schema public.
-- ============================================================

BEGIN;

-- ---------- Xoá theo thứ tự an toàn ----------
DROP TABLE IF EXISTS follows CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS fraud_flags CASCADE;
DROP TABLE IF EXISTS ai_predictions CASCADE;
DROP TABLE IF EXISTS ai_recommendations CASCADE;
DROP TABLE IF EXISTS user_interests CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS project_updates CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS pledges CASCADE;
DROP TABLE IF EXISTS rewards CASCADE;
DROP TABLE IF EXISTS project_collaborators CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS kyc_status CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;
DROP TYPE IF EXISTS project_status CASCADE;
DROP TYPE IF EXISTS collaborator_role CASCADE;
DROP TYPE IF EXISTS pledge_status CASCADE;
DROP TYPE IF EXISTS transaction_type CASCADE;
DROP TYPE IF EXISTS transaction_status CASCADE;
DROP TYPE IF EXISTS fraud_entity_type CASCADE;
DROP TYPE IF EXISTS review_status CASCADE;
DROP TYPE IF EXISTS report_status CASCADE;

-- ---------- ENUM ----------
CREATE TYPE user_role            AS ENUM ('backer', 'owner', 'admin');
CREATE TYPE kyc_status           AS ENUM ('none', 'pending', 'verified');
CREATE TYPE user_status          AS ENUM ('active', 'locked');
CREATE TYPE project_status       AS ENUM ('draft', 'pending_review', 'active', 'successful', 'failed', 'canceled');
CREATE TYPE collaborator_role    AS ENUM ('editor', 'moderator');
CREATE TYPE pledge_status        AS ENUM ('pending', 'paid', 'refunded', 'failed');
CREATE TYPE transaction_type     AS ENUM ('payment', 'refund', 'payout');
CREATE TYPE transaction_status   AS ENUM ('pending', 'success', 'failed');
CREATE TYPE fraud_entity_type    AS ENUM ('user', 'project', 'pledge');
CREATE TYPE review_status        AS ENUM ('pending', 'confirmed', 'false_positive');
CREATE TYPE report_status        AS ENUM ('open', 'reviewed', 'closed');

-- ============================================================
-- 1. users
-- ============================================================
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone         VARCHAR(30),
  avatar_url    TEXT,
  role          user_role NOT NULL DEFAULT 'backer',
  kyc_status    kyc_status NOT NULL DEFAULT 'none',
  trust_score   NUMERIC(5,2) NOT NULL DEFAULT 60 CHECK (trust_score BETWEEN 0 AND 100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        user_status NOT NULL DEFAULT 'active',
  -- Xác thực email + đặt lại mật khẩu (token chỉ lưu dạng SHA-256)
  email_verified_at              TIMESTAMPTZ,
  verification_token_hash        CHAR(64),
  verification_token_expires_at  TIMESTAMPTZ,
  reset_token_hash               CHAR(64),
  reset_token_expires_at         TIMESTAMPTZ,
  token_version                  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX users_email_lower_uidx ON users (lower(email));
CREATE INDEX users_verification_token_idx ON users (verification_token_hash)
  WHERE verification_token_hash IS NOT NULL;
CREATE INDEX users_reset_token_idx ON users (reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;

-- ============================================================
-- 2. categories
-- ============================================================
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. projects
-- ============================================================
CREATE TABLE projects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category_id      UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  title            VARCHAR(200) NOT NULL,
  description      TEXT NOT NULL,
  cover_image_url  TEXT,
  cover_emoji      VARCHAR(8) DEFAULT '🌱', -- cột bổ sung cho UI fallback
  goal_amount      NUMERIC(14,0) NOT NULL CHECK (goal_amount > 0),
  current_amount   NUMERIC(14,0) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  status           project_status NOT NULL DEFAULT 'draft',
  ai_success_score NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (ai_success_score BETWEEN 0 AND 100),
  fraud_risk_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (fraud_risk_score BETWEEN 0 AND 100),
  reject_reason    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT projects_date_order CHECK (end_date > start_date)
);

-- ============================================================
-- 4. project_collaborators
-- ============================================================
CREATE TABLE project_collaborators (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        collaborator_role NOT NULL DEFAULT 'editor',
  invited_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  PRIMARY KEY (project_id, user_id)
);

-- ============================================================
-- 5. rewards
-- ============================================================
CREATE TABLE rewards (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title              VARCHAR(160) NOT NULL,
  description        TEXT,
  min_amount         NUMERIC(14,0) NOT NULL CHECK (min_amount > 0),
  quantity_available INT NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  quantity_claimed   INT NOT NULL DEFAULT 0 CHECK (quantity_claimed >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. pledges
-- ============================================================
CREATE TABLE pledges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  backer_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reward_id   UUID REFERENCES rewards(id) ON DELETE SET NULL,
  amount      NUMERIC(14,0) NOT NULL CHECK (amount > 0),
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  status      pledge_status NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. transactions
-- ============================================================
CREATE TABLE transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pledge_id   UUID REFERENCES pledges(id) ON DELETE SET NULL,
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  type        transaction_type NOT NULL,
  amount      NUMERIC(14,0) NOT NULL CHECK (amount > 0),
  method      VARCHAR(30),
  gateway_ref VARCHAR(80),
  status      transaction_status NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 8. project_updates
-- ============================================================
CREATE TABLE project_updates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES users(id) ON DELETE SET NULL, -- cột bổ sung: người đăng
  title      VARCHAR(180) NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 9. comments
-- ============================================================
CREATE TABLE comments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  content           TEXT NOT NULL CHECK (length(trim(content)) > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 10. user_interests
-- ============================================================
CREATE TABLE user_interests (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  weight      NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (weight BETWEEN 0 AND 1),
  PRIMARY KEY (user_id, category_id)
);

-- ============================================================
-- 11. ai_recommendations
-- ============================================================
CREATE TABLE ai_recommendations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  score        NUMERIC(4,3) NOT NULL CHECK (score BETWEEN 0 AND 1),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);

-- ============================================================
-- 12. ai_predictions
-- ============================================================
CREATE TABLE ai_predictions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  success_probability NUMERIC(5,2) NOT NULL CHECK (success_probability BETWEEN 0 AND 100),
  model_version       VARCHAR(20) NOT NULL DEFAULT 'v2.3',
  features_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
  predicted_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 13. fraud_flags
-- ============================================================
CREATE TABLE fraud_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   fraud_entity_type NOT NULL,
  entity_id     UUID NOT NULL,
  risk_score    NUMERIC(5,2) NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  reason        TEXT NOT NULL,
  flagged_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  review_status review_status NOT NULL DEFAULT 'pending',
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ
);

-- ============================================================
-- 14. reports
-- ============================================================
CREATE TABLE reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  status      report_status NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

-- ============================================================
-- 15. notifications
-- ============================================================
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(30) NOT NULL DEFAULT 'info',
  content    TEXT NOT NULL,
  link       TEXT, -- cột bổ sung: điều hướng nhanh trên UI
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 16. follows
-- ============================================================
CREATE TABLE follows (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

-- ============================================================
--  INDEX
-- ============================================================
CREATE INDEX projects_status_idx        ON projects (status);
CREATE INDEX projects_category_idx      ON projects (category_id);
CREATE INDEX projects_owner_idx         ON projects (owner_id);
CREATE INDEX projects_end_date_idx      ON projects (end_date);
CREATE INDEX pledges_project_idx        ON pledges (project_id);
CREATE INDEX pledges_backer_idx         ON pledges (backer_id);
CREATE INDEX pledges_status_idx         ON pledges (status);
CREATE INDEX transactions_project_idx   ON transactions (project_id);
CREATE INDEX transactions_type_status_idx ON transactions (type, status);
CREATE INDEX comments_project_idx       ON comments (project_id);
CREATE INDEX comments_parent_idx        ON comments (parent_comment_id);
CREATE INDEX notifications_user_idx     ON notifications (user_id, is_read);
CREATE INDEX follows_project_idx        ON follows (project_id);
CREATE INDEX reports_status_idx         ON reports (status);
CREATE INDEX fraud_flags_status_idx     ON fraud_flags (review_status);
CREATE INDEX project_collaborators_user_idx ON project_collaborators (user_id);
CREATE INDEX ai_predictions_project_idx ON ai_predictions (project_id);

-- ============================================================
--  TRIGGER: cập nhật updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at      BEFORE UPDATE ON users      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER projects_set_updated_at   BEFORE UPDATE ON projects   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER rewards_set_updated_at    BEFORE UPDATE ON rewards    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER pledges_set_updated_at    BEFORE UPDATE ON pledges    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
--  TRIGGER: đồng bộ tiền đã gọi + số suất reward đã nhận
--  Chạy sau mỗi INSERT/UPDATE/DELETE trên pledges.
--  Với quy mô đồ án (vài chục pledge), recompute toàn bộ là đủ nhanh
--  và đảm bảo không bao giờ lệch số.
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_pledge_aggregates() RETURNS TRIGGER AS $$
BEGIN
  UPDATE projects p
     SET current_amount = COALESCE((
           SELECT SUM(pl.amount)
             FROM pledges pl
            WHERE pl.project_id = p.id
              AND pl.status = 'paid'
         ), 0);

  UPDATE rewards r
     SET quantity_claimed = COALESCE((
           SELECT COUNT(*)
             FROM pledges pl
            WHERE pl.reward_id = r.id
              AND pl.status = 'paid'
         ), 0);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pledges_refresh_aggregates
AFTER INSERT OR UPDATE OR DELETE ON pledges
FOR EACH STATEMENT EXECUTE FUNCTION refresh_pledge_aggregates();

COMMIT;
