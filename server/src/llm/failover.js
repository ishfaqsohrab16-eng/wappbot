/** Detect Google Gemini / OpenAI-style quota and rate-limit errors. */
export function isQuotaOrRateLimit(err) {
  if (!err) return false;
  const status = Number(err.status || err.statusCode || err.response?.status || 0);
  if (status === 429) return true;
  const msg = [
    err.message,
    err.code,
    err.error?.message,
    err.error?.code,
    err.error?.status,
    err.cause?.message,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /resource.?exhausted|quota|rate.?limit|too many requests|exceeded your current quota|billing/.test(msg);
}
