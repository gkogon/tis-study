import { Router, type IRouter } from "express";
import { listProjects, getProject } from "../lib/tis-projects";
import { getOrCreateFirmForUser } from "../lib/firms";

const router: IRouter = Router();

router.get("/projects", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to view projects." });
    return;
  }
  try {
    const user = req.user!;
    const { firm } = await getOrCreateFirmForUser(user.id, {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    const items = await listProjects(firm.id);
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "tis-projects.list_failed");
    res.status(500).json({ error: "Failed to load projects." });
  }
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to view projects." });
    return;
  }
  const id = String(req.params.id);
  // Cheap UUID format guard so we don't shove arbitrary strings into the
  // PK lookup. Drizzle would reject anyway, but this returns a clean 404.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  try {
    const user = req.user!;
    const { firm } = await getOrCreateFirmForUser(user.id, {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    const project = await getProject(firm.id, id);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json({
      id: project.id,
      studyType: project.studyType,
      projectName: project.projectName,
      landUseCode: project.landUseCode,
      siteLat: project.siteLat,
      siteLon: project.siteLon,
      version: project.version,
      createdAt: project.createdAt.toISOString(),
      request: project.requestPayload,
      result: project.resultPayload,
    });
  } catch (err) {
    req.log.error({ err }, "tis-projects.get_failed");
    res.status(500).json({ error: "Failed to load project." });
  }
});

export default router;
