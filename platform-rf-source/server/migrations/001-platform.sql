CREATE SCHEMA IF NOT EXISTS fiverox;
REVOKE ALL ON SCHEMA fiverox FROM PUBLIC;
CREATE TABLE IF NOT EXISTS fiverox.schema_versions (version int PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS fiverox.dealers (id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 254), active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS fiverox.users (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL CHECK(email=lower(btrim(email))), name text NOT NULL DEFAULT '',
 role text NOT NULL CHECK(role IN ('admin','coordinator','dealer_manager')), dealer_id uuid REFERENCES fiverox.dealers(id),
 active boolean NOT NULL DEFAULT true, session_version int NOT NULL DEFAULT 1,
 CHECK((role='dealer_manager')=(dealer_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS fiverox.clients (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 64), master jsonb NOT NULL CHECK(jsonb_typeof(master)='object'),
 staff_fields jsonb NOT NULL CHECK(jsonb_typeof(staff_fields)='array' AND jsonb_array_length(staff_fields)=8),
 kind text NOT NULL DEFAULT 'inquiry' CHECK(kind IN ('inquiry','customer')), profile_data jsonb NOT NULL DEFAULT '{}',
 version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES fiverox.users(id)
);
CREATE TABLE IF NOT EXISTS fiverox.transfers (
 id uuid PRIMARY KEY, client_id text NOT NULL REFERENCES fiverox.clients(id), dealer_id uuid NOT NULL REFERENCES fiverox.dealers(id),
 assignee_id uuid NOT NULL REFERENCES fiverox.users(id), status text NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','active','declined','cancelled','revoked','expired')),
 note text NOT NULL DEFAULT '', company_name text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '', expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL REFERENCES fiverox.users(id), accepted_at timestamptz, ended_at timestamptz,
 end_reason text NOT NULL DEFAULT '', fields jsonb NOT NULL CHECK(jsonb_array_length(fields)=8),
 shared_contacts jsonb NOT NULL DEFAULT '{}', version int NOT NULL DEFAULT 1,
 UNIQUE(client_id,id), CHECK(expires_at>created_at),
 CHECK(status <> 'active' OR (accepted_at IS NOT NULL AND ended_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_transfer ON fiverox.transfers(client_id) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_transfer ON fiverox.transfers(client_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS fiverox.items (
 id uuid PRIMARY KEY, client_id text NOT NULL REFERENCES fiverox.clients(id), assignment_id uuid,
 kind text NOT NULL CHECK(kind IN ('activity','sale','contact')), record jsonb NOT NULL,
 version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL REFERENCES fiverox.users(id),
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid NOT NULL REFERENCES fiverox.users(id),
 FOREIGN KEY(client_id,assignment_id) REFERENCES fiverox.transfers(client_id,id)
);
CREATE INDEX IF NOT EXISTS items_client_scope ON fiverox.items(client_id,assignment_id,kind);
CREATE TABLE IF NOT EXISTS fiverox.audit (
 id uuid PRIMARY KEY, client_id text REFERENCES fiverox.clients(id), assignment_id uuid, actor_id uuid NOT NULL REFERENCES fiverox.users(id),
 actor_email text NOT NULL, action text NOT NULL, changes jsonb NOT NULL, operation_id uuid NOT NULL,
 happened_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(client_id,assignment_id) REFERENCES fiverox.transfers(client_id,id)
);
CREATE TABLE IF NOT EXISTS fiverox.operations (
 actor_id uuid NOT NULL REFERENCES fiverox.users(id), operation_id uuid NOT NULL, request_digest text NOT NULL,
 response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,operation_id)
);
CREATE TABLE IF NOT EXISTS fiverox.sessions (
 digest text PRIMARY KEY, user_id uuid NOT NULL REFERENCES fiverox.users(id), user_version int NOT NULL,
 csrf_digest text NOT NULL, csrf_token text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fiverox.challenges (
 id uuid PRIMARY KEY, email text NOT NULL, user_id uuid REFERENCES fiverox.users(id), code_digest text NOT NULL,
 attempts int NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fiverox.rate_limits (key text PRIMARY KEY, bucket bigint NOT NULL, count int NOT NULL);
CREATE TABLE IF NOT EXISTS fiverox.invitations (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES fiverox.users(id), invited_by uuid NOT NULL REFERENCES fiverox.users(id),
 expires_at timestamptz NOT NULL, accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS is defense in depth. Server transactions set the verified actor ID, never a browser role.
-- Use a separate non-owner runtime role (NOBYPASSRLS), not the migration administrator.
CREATE OR REPLACE FUNCTION fiverox.actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('fiverox.actor_id',true),'')::uuid
$$;
CREATE OR REPLACE FUNCTION fiverox.is_staff() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM fiverox.users WHERE id=fiverox.actor_id() AND active AND role IN ('admin','coordinator'))
$$;
ALTER TABLE fiverox.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiverox.clients FORCE ROW LEVEL SECURITY;
ALTER TABLE fiverox.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiverox.transfers FORCE ROW LEVEL SECURITY;
ALTER TABLE fiverox.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiverox.items FORCE ROW LEVEL SECURITY;
ALTER TABLE fiverox.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiverox.audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clients_scope ON fiverox.clients;
CREATE POLICY clients_scope ON fiverox.clients USING (
 fiverox.is_staff() OR id=nullif(current_setting('fiverox.transfer_client',true),'') OR EXISTS(SELECT 1 FROM fiverox.transfers t JOIN fiverox.users u ON u.id=t.assignee_id
 WHERE t.client_id=clients.id AND t.assignee_id=fiverox.actor_id() AND t.status='active'
 AND u.active AND u.dealer_id=t.dealer_id)
) WITH CHECK(fiverox.is_staff());
-- The server performs exact transition authorization under the client lock.
DROP POLICY IF EXISTS transfers_scope ON fiverox.transfers;
CREATE POLICY transfers_scope ON fiverox.transfers USING(fiverox.is_staff() OR (assignee_id=fiverox.actor_id() AND EXISTS(SELECT 1 FROM fiverox.users u WHERE u.id=fiverox.actor_id() AND u.active AND u.role='dealer_manager' AND u.dealer_id=transfers.dealer_id)) OR client_id=nullif(current_setting('fiverox.transfer_client',true),''));
DROP POLICY IF EXISTS items_scope ON fiverox.items;
CREATE POLICY items_scope ON fiverox.items USING(fiverox.is_staff() OR EXISTS(
 SELECT 1 FROM fiverox.transfers t JOIN fiverox.users u ON u.id=t.assignee_id
 WHERE t.id=items.assignment_id AND t.client_id=items.client_id AND t.status='active'
 AND t.assignee_id=fiverox.actor_id() AND u.active AND u.dealer_id=t.dealer_id
));
DROP POLICY IF EXISTS audit_scope ON fiverox.audit;
CREATE POLICY audit_scope ON fiverox.audit USING(fiverox.is_staff() OR client_id=nullif(current_setting('fiverox.transfer_client',true),'') OR EXISTS(
 SELECT 1 FROM fiverox.transfers t JOIN fiverox.users u ON u.id=t.assignee_id
 WHERE t.id=audit.assignment_id AND t.client_id=audit.client_id AND t.status='active'
 AND t.assignee_id=fiverox.actor_id() AND u.active AND u.dealer_id=t.dealer_id
));
INSERT INTO fiverox.schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;
