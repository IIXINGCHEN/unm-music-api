import { Hono } from "hono";
import { infoRoute } from "./routeInfo.js";
import { musicRoute } from "./routeMusic.js";
import { resourceRoute } from "./routeResource.js";
import { monitorRoute } from "./routeMonitor.js";

const routes = new Hono();

routes.route("/", infoRoute);
routes.route("/", musicRoute);
routes.route("/", resourceRoute);
routes.route("/", monitorRoute);

export { routes, infoRoute, musicRoute, resourceRoute, monitorRoute };
