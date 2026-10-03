CREATE TABLE "authorization_assignment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authorization_assignment_scope_check" CHECK ("authorization_assignment"."scope_kind" IN ('user', 'tenant'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "authorization_assignment_tuple_idx" ON "authorization_assignment" USING btree ("scope_kind","scope_id","user_id","role_id");--> statement-breakpoint
CREATE INDEX "authorization_assignment_scope_created_idx" ON "authorization_assignment" USING btree ("scope_kind","scope_id","created_at","id");