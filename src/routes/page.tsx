import { Hono } from "hono";
import type { Bindings } from "../types";
import { DiagnosisPage } from "../components/DiagnosisPage";

const page = new Hono<{ Bindings: Bindings }>();

page.get("/", (c) => {
  return c.html(<DiagnosisPage />);
});

export { page };
