import { handle } from "hono/netlify";
import { app } from "../../src/app.js";

export const config = {
  path: "/*",
  preferStatic: true,
};

export const handler = handle(app);
