import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tisRouter from "./tis";
import parkingRouter from "./parking";
import warrantsRouter from "./warrants";
import sightDistanceRouter from "./sight-distance";
import leadsRouter from "./leads";
import authRouter from "./auth";
import projectsRouter from "./projects";
import firmsRouter from "./firms";
import billingRouter from "./billing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(tisRouter);
router.use(parkingRouter);
router.use(warrantsRouter);
router.use(sightDistanceRouter);
router.use(projectsRouter);
router.use(leadsRouter);
router.use(firmsRouter);
router.use(billingRouter);

export default router;
