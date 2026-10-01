import type postgres from 'postgres'

export async function createProbeSchema(observer: ReturnType<typeof postgres>) {
  await observer.unsafe(`
    CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL, email_verified boolean NOT NULL DEFAULT false, image text, created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now());
    CREATE TABLE session (id text PRIMARY KEY, token text UNIQUE NOT NULL, user_id text NOT NULL, expires_at timestamptz NOT NULL, ip_address text, user_agent text, active_organization_id text, created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now());
    CREATE TABLE account (id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL, access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz, scope text, password text, created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now());
    CREATE TABLE verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now());
    CREATE TABLE organization (id text PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, logo text, metadata text, created_at timestamptz(3) NOT NULL DEFAULT now());
    CREATE TABLE member (id text PRIMARY KEY, organization_id text NOT NULL, user_id text NOT NULL, role text NOT NULL CHECK(role IN ('owner','admin','member')), created_at timestamptz(3) NOT NULL DEFAULT now(), UNIQUE(organization_id,user_id));
    CREATE UNIQUE INDEX member_one_owner_idx ON member (organization_id) WHERE role = 'owner';
    CREATE TABLE invitation (id text PRIMARY KEY, organization_id text NOT NULL, email text NOT NULL, role text NOT NULL, status text NOT NULL, inviter_id text NOT NULL, expires_at timestamptz(3) NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now());
    INSERT INTO "user" (id,name,email,email_verified) VALUES ('probe-owner','Owner','owner@example.test',true), ('probe-recipient','Recipient','recipient@example.test',true);
    INSERT INTO session (id,token,user_id,expires_at) VALUES ('probe-session','probe-session-token','probe-recipient', now() + interval '1 hour');
    INSERT INTO organization (id,name,slug) VALUES ('probe-organization','Probe','probe-organization');
    INSERT INTO member (id,organization_id,user_id,role) VALUES ('probe-owner-member','probe-organization','probe-owner','owner');
    CREATE FUNCTION pause_probe_member() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.user_id = 'probe-recipient' THEN PERFORM pg_advisory_xact_lock(7462,99); END IF;
        RETURN NEW;
      END;
    $$;
    CREATE TRIGGER pause_probe_member BEFORE INSERT ON member FOR EACH ROW EXECUTE FUNCTION pause_probe_member();
  `)
}
