/**
 * Post-Build Verification endpoints.
 *
 *   POST /monitoring/enrollments            enroll a project for verification
 *   GET  /monitoring/enrollments            list firm's enrollments + last report
 *   GET  /monitoring/enrollments/:id/reports list reports
 *   POST /monitoring/enrollments/:id/run    generate a report on demand
 *   DELETE /monitoring/enrollments/:id      cancel monitoring
 */
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  monitoringEnrollmentsTable,
  monitoringReportsTable,
  tisProjectsTable,
} from "@workspace/db";
import { getOrCreateFirmForUser } from "../lib/firms";
import { generateMonitoringReport, persistMonitoringReport } from "../lib/monitoring";

const router: IRouter = Router();

router.post("/monitoring/enrollments", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to enroll a project." });
    return;
  }
  const user = req.user!;
  const body = req.body as {
    projectId?: string;
    label?: string;
    expectedOpenDate?: string;
    siteLat?: number;
    siteLon?: number;
    forecastSnapshot?: unknown;
  };
  if (!body.label || !body.siteLat || !body.siteLon || !body.forecastSnapshot) {
    res.status(400).json({ error: "label, siteLat, siteLon, and forecastSnapshot are required." });
    return;
  }

  const { firm } = await getOrCreateFirmForUser(user.id, {
    email: user.email, firstName: user.firstName, lastName: user.lastName,
  });

  // If a project is referenced, make sure it belongs to this firm.
  let projectId: string | null = null;
  if (body.projectId) {
    const [project] = await db
      .select()
      .from(tisProjectsTable)
      .where(and(eq(tisProjectsTable.id, body.projectId), eq(tisProjectsTable.firmId, firm.id)))
      .limit(1);
    if (!project) {
      res.status(400).json({ error: "Project not found in your firm." });
      return;
    }
    projectId = project.id;
  }

  const [enrollment] = await db
    .insert(monitoringEnrollmentsTable)
    .values({
      firmId: firm.id,
      projectId,
      label: String(body.label).slice(0, 200),
      siteLat: String(body.siteLat),
      siteLon: String(body.siteLon),
      forecastSnapshot: body.forecastSnapshot as object,
      enrolledByUserId: user.id,
      expectedOpenDate: body.expectedOpenDate ? new Date(body.expectedOpenDate) : null,
    })
    .returning();
  res.status(201).json({ enrollment });
});

router.get("/monitoring/enrollments", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in." });
    return;
  }
  const user = req.user!;
  const { firm } = await getOrCreateFirmForUser(user.id, {
    email: user.email, firstName: user.firstName, lastName: user.lastName,
  });
  const enrollments = await db
    .select()
    .from(monitoringEnrollmentsTable)
    .where(eq(monitoringEnrollmentsTable.firmId, firm.id))
    .orderBy(desc(monitoringEnrollmentsTable.enrolledAt));
  res.json({ items: enrollments });
});

router.get("/monitoring/enrollments/:id/reports", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in." });
    return;
  }
  const user = req.user!;
  const { firm } = await getOrCreateFirmForUser(user.id, {
    email: user.email, firstName: user.firstName, lastName: user.lastName,
  });
  const enrollmentId = String(req.params.id);
  const [enrollment] = await db
    .select()
    .from(monitoringEnrollmentsTable)
    .where(
      and(
        eq(monitoringEnrollmentsTable.id, enrollmentId),
        eq(monitoringEnrollmentsTable.firmId, firm.id),
      ),
    )
    .limit(1);
  if (!enrollment) {
    res.status(404).json({ error: "Enrollment not found." });
    return;
  }
  const reports = await db
    .select()
    .from(monitoringReportsTable)
    .where(eq(monitoringReportsTable.enrollmentId, enrollmentId))
    .orderBy(desc(monitoringReportsTable.createdAt))
    .limit(36);
  res.json({ enrollment, reports });
});

router.post("/monitoring/enrollments/:id/run", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in." });
    return;
  }
  const user = req.user!;
  const { firm } = await getOrCreateFirmForUser(user.id, {
    email: user.email, firstName: user.firstName, lastName: user.lastName,
  });
  const enrollmentId = String(req.params.id);
  const [enrollment] = await db
    .select()
    .from(monitoringEnrollmentsTable)
    .where(
      and(
        eq(monitoringEnrollmentsTable.id, enrollmentId),
        eq(monitoringEnrollmentsTable.firmId, firm.id),
      ),
    )
    .limit(1);
  if (!enrollment) {
    res.status(404).json({ error: "Enrollment not found." });
    return;
  }
  try {
    const payload = await generateMonitoringReport(enrollment);
    const report = await persistMonitoringReport({
      enrollment, payload, generatedByUserId: user.id,
    });
    res.json({ report, payload });
  } catch (err) {
    req.log.error({ err }, "monitoring.run_failed");
    res.status(500).json({ error: "Failed to generate report." });
  }
});

router.delete("/monitoring/enrollments/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in." });
    return;
  }
  const user = req.user!;
  const { firm } = await getOrCreateFirmForUser(user.id, {
    email: user.email, firstName: user.firstName, lastName: user.lastName,
  });
  const id = String(req.params.id);
  await db
    .delete(monitoringEnrollmentsTable)
    .where(
      and(
        eq(monitoringEnrollmentsTable.id, id),
        eq(monitoringEnrollmentsTable.firmId, firm.id),
      ),
    );
  res.json({ ok: true });
});

export default router;
