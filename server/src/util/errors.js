export class AppError extends Error {
  constructor(code, status, userMessage, cause) {
    super(userMessage);
    this.code = code;
    this.status = status;
    this.userMessage = userMessage;
    if (cause) this.cause = cause;
  }
}

export class QueueFullError extends AppError {
  constructor() {
    super("queue_full", 503, "The assistant is busy right now. Please try again in a minute.");
    this.retryAfterSec = 30;
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSec) {
    super("rate_limited", 429, "You are sending messages too quickly. Please slow down.");
    this.retryAfterSec = retryAfterSec;
  }
}

export class AbortedError extends AppError {
  constructor() {
    super("aborted", 499, "Request cancelled.");
  }
}

/** Map any thrown error to a safe AppError. Never leaks upstream text. */
export function toAppError(err) {
  if (err instanceof AppError) return err;
  const name = err?.name || "";
  const code = err?.code || err?.cause?.code || "";
  if (code === "sql_failed")
    return new AppError("sql_failed", 422, "I couldn't fetch that information. Please rephrase your question or be more specific.", err);
  if (name === "AbortError" || name === "APIUserAbortError") return new AbortedError();
  if (name === "APIConnectionTimeoutError" || code === "ETIMEDOUT" || name === "TimeoutError")
    return new AppError("timeout", 504, "The AI took too long to answer. Please try a shorter question.", err);
  if (
    name === "APIConnectionError" ||
    ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET"].includes(code)
  )
    return new AppError("ai_unavailable", 502, "AI service unavailable. Please try again later.", err);
  return new AppError("internal", 500, "Something went wrong. Please try again.", err);
}
