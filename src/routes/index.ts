import { Hono } from "hono";
import { infoRoute } from "./info.js";
import { musicRoute } from "./music.js";
import { resourceRoute } from "./resource.js";
import { monitorRoute } from "./monitor.js";

const routes = new Hono();

routes.route("/", infoRoute);
routes.route("/", musicRoute);
routes.route("/", resourceRoute);
routes.route("/", monitorRoute);

export { routes };
