import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tisRouter from "./tis";
import parkingRouter from "./parking";
import warrantsRouter from "./warrants";
import sightDistanceRouter from "./sight-distance";
import queuingRouter from "./queuing";
import roadDietRouter from "./road-diet";
import monitoringRouter from "./monitoring";
import leadsRouter from "./leads";
import authRouter from "./auth";
import emailAuthRouter from "./email-auth";
import projectsRouter from "./projects";
import firmsRouter from "./firms";
import billingRouter from "./billing";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(emailAuthRouter);
router.use(tisRouter);
router.use(parkingRouter);
router.use(warrantsRouter);
router.use(sightDistanceRouter);
router.use(queuingRouter);
router.use(roadDietRouter);
router.use(monitoringRouter);
router.use(projectsRouter);
router.use(leadsRouter);
router.use(firmsRouter);
router.use(billingRouter);
router.use(adminRouter);

export default router;
