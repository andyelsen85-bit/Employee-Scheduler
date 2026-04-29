import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import departmentsRouter from "./departments.js";
import employeesRouter from "./employees.js";
import officesRouter from "./offices.js";
import shiftCodesRouter from "./shiftCodes.js";
import weekTemplatesRouter from "./weekTemplates.js";
import monthlyConfigsRouter from "./monthlyConfigs.js";
import holidaysRouter from "./holidays.js";
import planningRouter from "./planning.js";
import dashboardRouter from "./dashboard.js";
import { permanenceRouter } from "./permanence.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(departmentsRouter);
router.use(employeesRouter);
router.use(officesRouter);
router.use(shiftCodesRouter);
router.use(weekTemplatesRouter);
router.use(monthlyConfigsRouter);
router.use(holidaysRouter);
router.use(planningRouter);
router.use(dashboardRouter);
router.use("/permanence", permanenceRouter);

export default router;
