import { handle } from "hono/netlify";
import { app } from "../../src/app.js";

export const handler = handle(app);
