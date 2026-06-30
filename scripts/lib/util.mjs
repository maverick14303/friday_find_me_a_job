export function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9+#. -]/g, " ").replace(/\s+/g, " ").trim();
}

export function termPresent(normalizedText, term) {
  const text = normalize(normalizedText);
  const value = normalize(term);
  if (!value) return false;
  if (/^[a-z0-9+#.]{1,3}$/.test(value)) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`).test(text);
  }
  return text.includes(value);
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function companyKey(value) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

export function safeName(value) {
  return String(value || "file").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "file";
}

export function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function cleanHtml(value) {
  return decodeHtml(String(value || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1] || "";
  }
  return "";
}

export function decodeDuckDuckGoUrl(url) {
  if (url.startsWith("//")) url = `https:${url}`;
  try {
    const parsed = new URL(url);
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url;
  } catch {
    return url;
  }
}

export function findEmails(text) {
  return unique((String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
    .filter((email) => !/example\.com|email\.com/i.test(email)));
}

export function inferLocation(text) {
  const lower = normalize(text);
  const locations = ["Remote", "Delhi", "Noida", "Gurgaon", "Gurugram", "Bengaluru", "Bangalore", "Hyderabad", "Pune", "Mumbai", "Chennai", "Jaipur", "Gandhinagar", "India"];
  const found = locations.find((location) => lower.includes(location.toLowerCase()));
  return found || "India / Remote";
}

export function safeText(text) {
  return text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

export function formatDateForPath(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-IST`;
}

export function formatHumanDate(date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
