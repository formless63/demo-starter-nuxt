CREATE TABLE "transfer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requester_id" varchar(128) NOT NULL,
	"scope_kind" varchar(6) NOT NULL,
	"scope_id" varchar(128) NOT NULL,
	"definition" varchar(64) NOT NULL,
	"version" varchar(64) NOT NULL,
	"direction" varchar(6) NOT NULL,
	"status" varchar(12) NOT NULL,
	"idempotency_key" varchar(128),
	"fingerprint" varchar(256),
	"source_key" text,
	"source_hash" varchar(64),
	"source_bytes" bigint,
	"artifact_key" text,
	"artifact_expires_at" timestamp (3) with time zone,
	"job_id" uuid,
	"row_count" integer,
	"byte_count" bigint,
	"error_code" varchar(32),
	"validation_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors_truncated" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp (3) with time zone,
	"completed_at" timestamp (3) with time zone,
	"snapshot_at" timestamp (3) with time zone,
	CONSTRAINT "transfer_scope_check" CHECK ("transfer"."scope_kind" in ('user', 'tenant')),
	CONSTRAINT "transfer_direction_check" CHECK ("transfer"."direction" in ('import', 'export')),
	CONSTRAINT "transfer_status_check" CHECK ("transfer"."status" in ('uploading', 'staged', 'pending', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_request_idempotency_idx" ON "transfer" USING btree ("requester_id","scope_kind","scope_id","direction","idempotency_key");--> statement-breakpoint
CREATE INDEX "transfer_visibility_created_idx" ON "transfer" USING btree ("requester_id","scope_kind","scope_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);