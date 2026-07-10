import { Hono } from "hono";
import type { Bindings } from "./types";
import { diagnose } from "./routes/diagnose";
import { page } from "./routes/page";

const app = new Hono<{ Bindings: Bindings }>();

app.route("/", page);

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/diagnose", diagnose);

export default app;
