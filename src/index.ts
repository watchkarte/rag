import { Hono } from "hono";
import type { Bindings } from "./types";
import { diagnose } from "./routes/diagnose";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => {
  return c.json({
    name: "clock-diagnosis-rag",
    description: "クォーツアナログ時計故障診断 RAG API (PoC)",
    endpoints: {
      diagnose: "POST /diagnose",
    },
  });
});

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/diagnose", diagnose);

export default app;
