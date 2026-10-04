CREATE TABLE "feature_flag_definition" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"default_value" boolean DEFAULT false NOT NULL,
	"rollout_basis_points" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flag_definition_revision_check" CHECK ("feature_flag_definition"."revision" >= 1),
	CONSTRAINT "feature_flag_definition_rollout_check" CHECK ("feature_flag_definition"."rollout_basis_points" IS NULL OR "feature_flag_definition"."rollout_basis_points" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "feature_flag_override" (
	"flag_key" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"value" boolean NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flag_override_flag_key_target_kind_target_id_pk" PRIMARY KEY("flag_key","target_kind","target_id"),
	CONSTRAINT "feature_flag_override_kind_check" CHECK ("feature_flag_override"."target_kind" IN ('user','tenant'))
);
--> statement-breakpoint
CREATE INDEX "feature_flag_definition_created_idx" ON "feature_flag_definition" USING btree ("created_at","key");--> statement-breakpoint
CREATE INDEX "feature_flag_override_created_idx" ON "feature_flag_override" USING btree ("flag_key","created_at","target_kind","target_id");