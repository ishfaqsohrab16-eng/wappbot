const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;

function fmt(v) {
  if (v instanceof Error) return v.stack || v.message;
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function write(level, args) {
  if (LEVELS[level] < minLevel) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${args.map(fmt).join(" ")}`;
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export const log = {
  debug: (...a) => write("debug", a),
  info: (...a) => write("info", a),
  warn: (...a) => write("warn", a),
  error: (...a) => write("error", a),
};

// Recent bot activity, shown in the dashboard. In memory only.
const ACTIVITY_MAX = 200;
const activity = [];

export function recordActivity(entry) {
  activity.unshift({ at: new Date().toISOString(), ...entry });
  if (activity.length > ACTIVITY_MAX) activity.length = ACTIVITY_MAX;
}

export function getActivity(limit = 100) {
  return activity.slice(0, limit);
}
