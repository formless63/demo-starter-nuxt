CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"actor_type" varchar(32) NOT NULL,
	"actor_id" varchar(128),
	"action" varchar(128) NOT NULL,
	"subject_type" varchar(64) NOT NULL,
	"subject_id" varchar(128),
	"outcome" varchar(32),
	"request_id" varchar(128),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_record" (
	"id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_event_created_id_idx" ON "audit_event" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_actor_created_id_idx" ON "audit_event" USING btree ("actor_type","actor_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_subject_created_id_idx" ON "audit_event" USING btree ("subject_type","subject_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);