CREATE TABLE "file_ui_files" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"object_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"digest" text NOT NULL,
	"fingerprint" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"size" integer NOT NULL,
	"state" text NOT NULL,
	"revision" integer NOT NULL,
	"writer_stopped" boolean NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "file_ui_owner_token" ON "file_ui_files" USING btree ("owner","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "file_ui_object_key" ON "file_ui_files" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "file_ui_owner_created" ON "file_ui_files" USING btree ("owner","created_at");