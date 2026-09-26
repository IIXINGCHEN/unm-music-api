import { Hono } from "hono";
import { infoRoute } from "./routeInfo.js";
import { musicRoute } from "./routeMusic.js";
import { resourceRoute } from "./routeResource.js";
import { monitorRoute } from "./routeMonitor.js";
import type { AppEnv } from "../types/typeApi.js";

const routes = new Hono<AppEnv>();

routes.route("/", infoRoute);
routes.route("/", musicRoute);
routes.route("/", resourceRoute);
routes.route("/", monitorRoute);

export { routes, infoRoute, musicRoute, resourceRoute, monitorRoute };
