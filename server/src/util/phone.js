import { config } from "../config.js";

/**
 * Normalize a phone number to international digits without "+", e.g.
 * "03337881264" -> "923337881264", "+92 333 7881264" -> "923337881264".
 * Returns null if it does not look like a phone number.
 */
export function normalizePhone(input, cc = config.defaultCountryCode) {
  if (input === undefined || input === null) return null;
  let s = String(input).trim();
  s = s.replace(/@.*$/, ""); // strip JID suffix
  s = s.replace(/:\d+$/, ""); // strip device suffix (e.g. 9233...:12)
  const hadPlus = s.startsWith("+");
  let d = s.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  else if (!hadPlus && d.startsWith("0")) d = cc + d.slice(1);
  else if (!hadPlus && cc && d.length <= 10 && !d.startsWith(cc)) d = cc + d;
  if (d.length < 8 || d.length > 15) return null;
  return d;
}

export function toJid(phone) {
  return `${phone}@s.whatsapp.net`;
}

export function displayPhone(phone) {
  return phone ? `+${phone}` : "";
}
