ALTER TABLE "stripe_inbox" ADD COLUMN "last_conflict_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "stripe_inbox" ADD COLUMN "reconcile_again" boolean DEFAULT false NOT NULL;