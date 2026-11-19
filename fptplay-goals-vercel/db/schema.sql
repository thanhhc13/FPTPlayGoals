-- =====================================================================
-- FPT Play Goals – Postgres schema (Neon)
-- Thay thế Google Sheet: Users, KPIPeriods, ManagerPlanVersions,
-- ManagerResultVersions, ManagerOTP, ManagerSessions
-- Chạy lại nhiều lần an toàn (IF NOT EXISTS).
-- =====================================================================

-- ---------- Users ----------
CREATE TABLE IF NOT EXISTS users (
  id          serial PRIMARY KEY,
  email       text NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name   text NOT NULL DEFAULT '',          -- Họ tên
  department  text NOT NULL DEFAULT '',          -- Phòng
  team        text NOT NULL DEFAULT '',          -- Nhóm
  role        text NOT NULL DEFAULT 'Manager',   -- Role (Manager = được lập KPI)
  is_hr       boolean NOT NULL DEFAULT false,    -- isHR = x
  is_admin    boolean NOT NULL DEFAULT false,    -- được cấp quyền isHR/Admin cho người khác
  cc_emails   text[] NOT NULL DEFAULT '{}',      -- cột N
  active      boolean NOT NULL DEFAULT true,
  extra       jsonb NOT NULL DEFAULT '{}'::jsonb, -- các cột khác của sheet cũ
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- KPIPeriods ----------
CREATE TABLE IF NOT EXISTS kpi_periods (
  id              text PRIMARY KEY,               -- Kì KPI
  name            text NOT NULL,                  -- Tên kỳ
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OPEN','CLOSED')), -- Trạng thái kỳ
  phase           text NOT NULL DEFAULT 'PLAN'  CHECK (phase IN ('PLAN','RESULT')),          -- Giai đoạn
  plan_deadline   timestamptz,
  result_deadline timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Chỉ được có đúng 1 kỳ OPEN
CREATE UNIQUE INDEX IF NOT EXISTS kpi_periods_one_open ON kpi_periods ((true)) WHERE status = 'OPEN';

-- ---------- ManagerPlanVersions (mỗi lần lưu = 1 dòng mới) ----------
CREATE TABLE IF NOT EXISTS plan_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- VersionID
  request_id      text NOT NULL UNIQUE,                        -- RequestID (chống lưu trùng)
  period_id       text NOT NULL REFERENCES kpi_periods(id) ON UPDATE CASCADE,
  user_id         int  NOT NULL REFERENCES users(id),
  full_name       text NOT NULL DEFAULT '',                    -- Họ tên lúc lưu
  department      text NOT NULL DEFAULT '',                    -- Phòng lúc lưu
  revision        int  NOT NULL DEFAULT 1,                     -- lần nộp (tăng khi được mở lại)
  status          text NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','SUPERSEDED')),
  saved_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  superseded_at   timestamptz,
  tasks           jsonb NOT NULL,                              -- TasksJSON
  mail_status     text NOT NULL DEFAULT '',                    -- PENDING | PROCESSING | SENT | FAILED
  mail_sent_at    timestamptz,
  mail_last_error text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS plan_one_submitted ON plan_versions (period_id, user_id) WHERE status = 'SUBMITTED';
CREATE INDEX IF NOT EXISTS plan_versions_owner ON plan_versions (period_id, user_id, saved_at);

-- ---------- ManagerResultVersions ----------
CREATE TABLE IF NOT EXISTS result_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      text NOT NULL UNIQUE,
  plan_version_id uuid NOT NULL REFERENCES plan_versions(id),  -- PlanVersionID
  period_id       text NOT NULL REFERENCES kpi_periods(id) ON UPDATE CASCADE,
  user_id         int  NOT NULL REFERENCES users(id),
  revision        int  NOT NULL DEFAULT 1,
  status          text NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','SUPERSEDED')),
  saved_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  superseded_at   timestamptz,
  results         jsonb NOT NULL,                              -- ResultsJSON
  total_score     numeric(12,6),                               -- TotalScore
  mail_status     text NOT NULL DEFAULT '',
  mail_sent_at    timestamptz,
  mail_last_error text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS result_one_submitted ON result_versions (period_id, user_id) WHERE status = 'SUBMITTED';
CREATE INDEX IF NOT EXISTS result_versions_owner ON result_versions (period_id, user_id, saved_at);

-- ---------- BĐH duyệt điểm ----------
CREATE TABLE IF NOT EXISTS bdh_reviews (
  id                serial PRIMARY KEY,
  period_id         text NOT NULL REFERENCES kpi_periods(id) ON UPDATE CASCADE,
  user_id           int  NOT NULL REFERENCES users(id),
  result_version_id uuid NOT NULL REFERENCES result_versions(id),
  status            text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED')),
  decisions         jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{taskId, completion, note}]
  score             numeric(12,6),
  comment           text NOT NULL DEFAULT '',
  reviewer_id       int REFERENCES users(id),
  approved_at       timestamptz,
  mail_status       text NOT NULL DEFAULT '',
  mail_sent_at      timestamptz,
  mail_last_error   text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, user_id)
);

-- ---------- Xin sửa kế hoạch đã nộp ----------
CREATE TABLE IF NOT EXISTS plan_edit_requests (
  id              serial PRIMARY KEY,
  period_id       text NOT NULL REFERENCES kpi_periods(id) ON UPDATE CASCADE,
  user_id         int  NOT NULL REFERENCES users(id),
  plan_version_id uuid REFERENCES plan_versions(id),
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  decided_by      int REFERENCES users(id),
  decided_at      timestamptz,
  decision_note   text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS edit_one_pending ON plan_edit_requests (period_id, user_id) WHERE status = 'PENDING';

-- ---------- ManagerOTP ----------
CREATE TABLE IF NOT EXISTS otp_challenges (
  id          uuid PRIMARY KEY,                 -- ChallengeID
  email       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  used_at     timestamptz,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS otp_challenges_email ON otp_challenges (email, created_at DESC);

-- ---------- ManagerSessions ----------
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   text PRIMARY KEY,
  user_id      int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  user_agent   text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- ---------- Nhật ký thao tác ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial PRIMARY KEY,
  user_id    int,
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log (created_at DESC);
