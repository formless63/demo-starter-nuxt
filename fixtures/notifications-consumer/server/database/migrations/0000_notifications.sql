CREATE TABLE "domain_record" (
	"id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_id" varchar(128) NOT NULL,
	"type" varchar(128) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE INDEX "notification_recipient_created_id_idx" ON "notification" USING btree ("recipient_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_recipient_read_created_id_idx" ON "notification" USING btree ("recipient_id","read_at","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_recipient_type_created_id_idx" ON "notification" USING btree ("recipient_id","type","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);