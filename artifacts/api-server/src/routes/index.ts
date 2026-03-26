import { Router, type IRouter } from "express";
import healthRouter from "./health";
import spaceWeatherRouter from "./spaceWeather";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/space-weather", spaceWeatherRouter);

export default router;
