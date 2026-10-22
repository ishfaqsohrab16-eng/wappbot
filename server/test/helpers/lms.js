// Test fixtures: the real LMS schema (from the admin Database page) and a small
// set of realistic lookup values. The query function records SQL + params.
import fs from "node:fs";

export function lmsSchema() {
  const raw = JSON.parse(fs.readFileSync(new URL("../fixtures/lms-schema.json", import.meta.url), "utf8"));
  const tables = new Map(
    Object.entries(raw).map(([n, t]) => [n, { rows: t.rows, columns: t.columns.map((c, i) => ({ name: c, type: "varchar", key: i === 0 ? "PRI" : "" })) }])
  );
  return { tables, loadedAt: "fixture" };
}

export const DICT = {
  batches: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Batch ${i + 1}`, slug: `batch-${i + 1}` })),
  centers: [
    { id: 1, name: "ITTI Quetta", location: "Quetta" },
    { id: 2, name: "BUITEMS Center", location: "Quetta" },
    { id: 3, name: "Turbat Center", location: "Turbat" },
    { id: 4, name: "Gwadar Center", location: "Gwadar" },
    { id: 5, name: "Khuzdar Center", location: "Khuzdar" },
    { id: 6, name: "Loralai Center", location: "Loralai" },
  ],
  courses: [
    { id: 1, name: "Web Development", full: "Full Stack Web Development" },
    { id: 2, name: "Graphic Design", full: "Graphic Design & Video Editing" },
    { id: 3, name: "Digital Marketing", full: "Digital Marketing & SEO" },
    { id: 4, name: "Freelancing", full: "Freelancing & E-commerce" },
  ],
  enums: {
    "student.gender": ["Male", "Female"],
    "student.district": ["Quetta", "Pishin", "Kech", "Gwadar", "Khuzdar"],
    "student.qualification": ["Intermediate", "Bachelors", "Masters"],
    "student.status": [1, 2],
    "candidate.gender": ["male", "female"],
    "candidate.status": [0, 1, 2],
    "attendance.status": ["Present", "Absent", "Leave"],
    "ticket.status": ["open", "closed"],
    "earning.status": [0, 1, 2],
    "earning.platform": ["Fiverr", "Upwork", "Local Client"],
    "leave.status": [0, 1, 2],
  },
  loadedAt: Date.now(),
};

/** Fake read-only DB: returns rows from `responder(sql, params)` and records calls. */
export function fakeDb(responder = () => []) {
  const calls = [];
  const query = async (sql, params = []) => {
    if (!/^\s*(select|with)\b/i.test(sql)) throw new Error(`non-SELECT reached the database: ${sql}`);
    calls.push({ sql, params });
    const rows = responder(sql, params);
    return { rows: rows ?? [] };
  };
  return { query, calls };
}
