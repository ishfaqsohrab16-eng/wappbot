/** Recent turns as a short "User:/Assistant:" transcript. */
export function transcript(history, maxChars = 2500) {
  const lines = [];
  let used = 0;
  for (const m of [...history].reverse()) {
    const content = m.content.length > 300 ? `${m.content.slice(0, 300)}…` : m.content;
    const line = `${m.role === "user" ? "User" : "Assistant"}: ${content.replace(/\s+/g, " ")}`;
    if (used + line.length > maxChars) break;
    lines.unshift(line);
    used += line.length;
  }
  return lines.join("\n");
}
