CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"organization" text,
	"role" text,
	"studies_per_month" integer,
	"tier_interest" text,
	"message" text,
	"source" text DEFAULT 'landing_page' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
