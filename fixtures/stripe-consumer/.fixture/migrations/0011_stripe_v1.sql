CREATE TABLE "stripe_binding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_kind" varchar(6) NOT NULL,
	"scope_id" varchar(128) NOT NULL,
	"local_resource_id" varchar(128) NOT NULL,
	"connection_id" varchar(64) NOT NULL,
	"resource_kind" varchar(8) NOT NULL,
	"remote_id" varchar(128) NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp (3) with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp (3) with time zone,
	CONSTRAINT "stripe_binding_scope_check" CHECK ("stripe_binding"."scope_kind" in ('user','tenant')),
	CONSTRAINT "stripe_binding_kind_check" CHECK ("stripe_binding"."resource_kind" in ('customer','checkout','payment'))
);
--> statement-breakpoint
CREATE TABLE "stripe_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" varchar(64) NOT NULL,
	"account_id" varchar(128) NOT NULL,
	"mode" varchar(4) NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"body_sha256" varchar(64) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"binding_id" uuid,
	"remote_hint" text,
	"status" varchar(12) NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp (3) with time zone,
	"error_code" varchar(32),
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_inbox_status_check" CHECK ("stripe_inbox"."status" in ('received','processing','processed','ignored','failed'))
);
--> statement-breakpoint
CREATE TABLE "stripe_operation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" varchar(128) NOT NULL,
	"scope_kind" varchar(6) NOT NULL,
	"scope_id" varchar(128) NOT NULL,
	"connection_id" varchar(64) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"binding_id" uuid NOT NULL,
	"caller_key" varchar(128) NOT NULL,
	"input_digest" varchar(64) NOT NULL,
	"intent" jsonb,
	"status" varchar(24) NOT NULL,
	"result_binding_id" uuid,
	"error_code" varchar(32),
	"first_dispatch_at" timestamp (3) with time zone,
	"lease_token" uuid,
	"lease_until" timestamp (3) with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_operation_status_check" CHECK ("stripe_operation"."status" in ('queued','dispatching','succeeded','failed','reconciliation_required','cancelled')),
	CONSTRAINT "stripe_operation_kind_check" CHECK ("stripe_operation"."kind" in ('create_checkout','reconcile_checkout','reconcile_payment'))
);
--> statement-breakpoint
CREATE TABLE "stripe_projection" (
	"binding_id" uuid PRIMARY KEY NOT NULL,
	"checkout" jsonb,
	"payment" jsonb,
	"synced_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stripe_inbox" ADD CONSTRAINT "stripe_inbox_binding_id_stripe_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."stripe_binding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_operation" ADD CONSTRAINT "stripe_operation_binding_id_stripe_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."stripe_binding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_operation" ADD CONSTRAINT "stripe_operation_result_binding_id_stripe_binding_id_fk" FOREIGN KEY ("result_binding_id") REFERENCES "public"."stripe_binding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_projection" ADD CONSTRAINT "stripe_projection_binding_id_stripe_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."stripe_binding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_binding_local_idx" ON "stripe_binding" USING btree ("scope_kind","scope_id","local_resource_id","connection_id","resource_kind") WHERE "stripe_binding"."retired_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_binding_remote_idx" ON "stripe_binding" USING btree ("connection_id","resource_kind","remote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_inbox_event_idx" ON "stripe_inbox" USING btree ("account_id","mode","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_operation_intent_idx" ON "stripe_operation" USING btree ("scope_kind","scope_id","connection_id","kind","caller_key");--> statement-breakpoint
CREATE INDEX "stripe_projection_created_idx" ON "stripe_projection" USING btree ("created_at" DESC NULLS LAST,"binding_id" DESC NULLS LAST);