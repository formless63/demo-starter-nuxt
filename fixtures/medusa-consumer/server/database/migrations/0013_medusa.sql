CREATE TABLE "medusa_binding" (
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
	"attempt_token" uuid,
	"lease_expires_at" timestamp (3) with time zone,
	CONSTRAINT "medusa_binding_scope_check" CHECK ("medusa_binding"."scope_kind" in ('user','tenant')),
	CONSTRAINT "medusa_binding_kind_check" CHECK ("medusa_binding"."resource_kind" in ('product','order'))
);
--> statement-breakpoint
CREATE TABLE "medusa_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" varchar(64) NOT NULL,
	"event_id" uuid NOT NULL,
	"body_sha256" varchar(64) NOT NULL,
	"event_type" varchar(20) NOT NULL,
	"remote_hint" varchar(128),
	"binding_id" uuid,
	"status" varchar(10) NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"attempt_token" uuid,
	"lease_expires_at" timestamp (3) with time zone,
	"error_code" varchar(32),
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medusa_inbox_status_check" CHECK ("medusa_inbox"."status" in ('received','processing','processed','ignored','failed')),
	CONSTRAINT "medusa_inbox_event_check" CHECK ("medusa_inbox"."event_type" in ('product.created','product.updated','product.deleted','order.placed','unknown'))
);
--> statement-breakpoint
CREATE TABLE "medusa_operation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" varchar(128) NOT NULL,
	"scope_kind" varchar(6) NOT NULL,
	"scope_id" varchar(128) NOT NULL,
	"connection_id" varchar(64) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"status" varchar(24) NOT NULL,
	"binding_id" uuid,
	"caller_key" varchar(128) NOT NULL,
	"digest" varchar(64) NOT NULL,
	"intent" jsonb NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"next_cursor" varchar(2048),
	"revision" integer DEFAULT 0 NOT NULL,
	"attempt_token" uuid,
	"lease_expires_at" timestamp (3) with time zone,
	"first_dispatch_at" timestamp (3) with time zone,
	"error_code" varchar(32),
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medusa_operation_scope_check" CHECK ("medusa_operation"."scope_kind" in ('user','tenant')),
	CONSTRAINT "medusa_operation_kind_check" CHECK ("medusa_operation"."kind" in ('reconcile_product','reconcile_order','sync_product_page','sync_order_page')),
	CONSTRAINT "medusa_operation_status_check" CHECK ("medusa_operation"."status" in ('queued','dispatching','succeeded','failed','reconciliation_required','cancelled')),
	CONSTRAINT "medusa_operation_progress_check" CHECK ("medusa_operation"."progress" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "medusa_projection" (
	"binding_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"synced_at" timestamp (3) with time zone NOT NULL,
	"revision" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "medusa_inbox" ADD CONSTRAINT "medusa_inbox_binding_id_medusa_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."medusa_binding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medusa_operation" ADD CONSTRAINT "medusa_operation_binding_id_medusa_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."medusa_binding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medusa_projection" ADD CONSTRAINT "medusa_projection_binding_id_medusa_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."medusa_binding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "medusa_binding_local_idx" ON "medusa_binding" USING btree ("scope_kind","scope_id","resource_kind","local_resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "medusa_binding_remote_idx" ON "medusa_binding" USING btree ("connection_id","resource_kind","remote_id");--> statement-breakpoint
CREATE INDEX "medusa_binding_scope_idx" ON "medusa_binding" USING btree ("scope_kind","scope_id","resource_kind","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "medusa_inbox_receipt_idx" ON "medusa_inbox" USING btree ("connection_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "medusa_operation_key_idx" ON "medusa_operation" USING btree ("scope_kind","scope_id","connection_id","kind","caller_key");--> statement-breakpoint
CREATE INDEX "medusa_operation_scope_idx" ON "medusa_operation" USING btree ("scope_kind","scope_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);