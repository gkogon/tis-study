import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { leads } from "../../db/schema.js";

export default async (req: Request) => {
  if (req.method === "POST") {
    const body = await req.json();

    const { name, email, organization, role, studiesPerMonth, tierInterest, message, source, website } = body;

    if (website) {
      return Response.json({ success: true }, { status: 200 });
    }

    if (!name || !email) {
      return Response.json({ error: "Name and email are required" }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return Response.json({ error: "Invalid email address" }, { status: 400 });
    }

    const [lead] = await db
      .insert(leads)
      .values({
        name: String(name).slice(0, 200),
        email: String(email).slice(0, 200),
        organization: organization ? String(organization).slice(0, 200) : null,
        role: role ? String(role).slice(0, 200) : null,
        studiesPerMonth: studiesPerMonth ? Number(studiesPerMonth) : null,
        tierInterest: tierInterest ? String(tierInterest).slice(0, 50) : null,
        message: message ? String(message).slice(0, 2000) : null,
        source: source ? String(source).slice(0, 50) : "landing_page",
      })
      .returning();

    return Response.json({ success: true, id: lead.id }, { status: 201 });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/leads",
};
