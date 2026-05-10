import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const leads = pgTable("leads", {
  id: serial().primaryKey(),
  name: text().notNull(),
  email: text().notNull(),
  organization: text(),
  role: text(),
  studiesPerMonth: integer("studies_per_month"),
  tierInterest: text("tier_interest"),
  message: text(),
  source: text().notNull().default("landing_page"),
  createdAt: timestamp("created_at").defaultNow(),
});
