import { Router, type IRouter } from "express";
import healthRouter from "./health";
import atlantaRouter from "./atlanta";

const router: IRouter = Router();

router.use(healthRouter);
router.use(atlantaRouter);

export default router;
