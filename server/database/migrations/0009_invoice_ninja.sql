CREATE TABLE "invoice_ninja_binding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_kind" varchar(6) NOT NULL,
	"scope_id" varchar(128) NOT NULL,
	"local_resource_id" varchar(128) NOT NULL,
	"connection_id" varchar(64) NOT NULL,
	"resource_kind" varchar(7) NOT NULL,
	"remote_id" varchar(128) NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp (3) with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp (3) with time zone,
	CONSTRAINT "invoice_ninja_binding_scope_check" CHECK ("invoice_ninja_binding"."scope_kind" IN ('user','tenant')),
	CONSTRAINT "invoice_ninja_binding_kind_check" CHECK ("invoice_ninja_binding"."resource_kind" IN ('client','invoice'))
);
--> statement-breakpoint
CREATE TABLE "invoice_ninja_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" varchar(64) NOT NULL,
	"event_kind" varchar(32) NOT NULL,
	"body_sha256" varchar(64) NOT NULL,
	"remote_hint" varchar(128),
	"binding_id" uuid,
	"status" varchar(16) DEFAULT 'received' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"attempt_token" uuid,
	"lease_until" timestamp (3) with time zone,
	"error_code" varchar(32),
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_ninja_inbox_status_check" CHECK ("invoice_ninja_inbox"."status" IN ('received','processing','processed','ignored','failed'))
);
--> statement-breakpoint
CREATE TABLE "invoice_ninja_operation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_kind" varchar(6) NOT NULL,
	"scope_id" varchar(128) NOT NULL,
	"actor_user_id" varchar(128) NOT NULL,
	"connection_id" varchar(64) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"caller_key" varchar(128) NOT NULL,
	"digest" varchar(64) NOT NULL,
	"binding_id" uuid NOT NULL,
	"result_binding_id" uuid,
	"intent" jsonb,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"known_remote_id" varchar(128),
	"error_code" varchar(32),
	"revision" integer DEFAULT 0 NOT NULL,
	"attempt_token" uuid,
	"lease_until" timestamp (3) with time zone,
	"first_dispatch_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_ninja_operation_kind_check" CHECK ("invoice_ninja_operation"."kind" IN ('create_draft','reconcile_invoice','reconcile_client')),
	CONSTRAINT "invoice_ninja_operation_status_check" CHECK ("invoice_ninja_operation"."status" IN ('queued','dispatching','succeeded','failed','reconciliation_required','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "invoice_ninja_projection" (
	"binding_id" uuid PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"synced_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_ninja_inbox" ADD CONSTRAINT "invoice_ninja_inbox_binding_id_invoice_ninja_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."invoice_ninja_binding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_ninja_operation" ADD CONSTRAINT "invoice_ninja_operation_binding_id_invoice_ninja_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."invoice_ninja_binding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_ninja_operation" ADD CONSTRAINT "invoice_ninja_operation_result_binding_id_invoice_ninja_binding_id_fk" FOREIGN KEY ("result_binding_id") REFERENCES "public"."invoice_ninja_binding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_ninja_projection" ADD CONSTRAINT "invoice_ninja_projection_binding_id_invoice_ninja_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."invoice_ninja_binding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_ninja_binding_local_idx" ON "invoice_ninja_binding" USING btree ("scope_kind","scope_id","local_resource_id","resource_kind") WHERE "invoice_ninja_binding"."retired_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_ninja_binding_remote_idx" ON "invoice_ninja_binding" USING btree ("connection_id","resource_kind","remote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_ninja_inbox_receipt_idx" ON "invoice_ninja_inbox" USING btree ("connection_id","event_kind","body_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_ninja_operation_key_idx" ON "invoice_ninja_operation" USING btree ("scope_kind","scope_id","connection_id","kind","caller_key");--> statement-breakpoint
CREATE INDEX "invoice_ninja_operation_lease_idx" ON "invoice_ninja_operation" USING btree ("status","lease_until");