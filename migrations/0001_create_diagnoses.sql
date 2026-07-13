CREATE TABLE IF NOT EXISTS diagnoses (
  id TEXT PRIMARY KEY,
  symptom TEXT NOT NULL,
  part TEXT NOT NULL,
  description TEXT
);
