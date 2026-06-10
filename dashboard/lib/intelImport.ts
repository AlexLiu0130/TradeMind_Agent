export interface ImportedSerenityPost {
  external_id: string | null;
  item_ts: string | null;
  url: string | null;
  text: string;
  raw: unknown;
}

const TEXT_KEYS = ["full_text", "rawContent", "text", "body", "content"];
const TIME_KEYS = ["created_at", "createdAt", "date", "time", "timestamp"];
const ID_KEYS = ["rest_id", "id_str", "id", "tweet_id", "tweetId"];

function cleanText(text: string) {
  return text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function findString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function findUrl(obj: Record<string, unknown>, id: string | null) {
  const direct = findString(obj, ["url", "tweet_url", "expanded_url"]);
  if (direct?.startsWith("http")) return direct;
  return id ? `https://x.com/aleabitoreddit/status/${id}` : null;
}

function isTweetText(text: string) {
  const cleaned = cleanText(text);
  if (cleaned.length < 8 || cleaned.length > 2000) return false;
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) return false;
  return /\$?[A-Z]{2,5}\b|semiconductor|memory|AI|stock|equities|companies|follow/i.test(cleaned);
}

function collectFromObject(value: unknown, posts: ImportedSerenityPost[], seen: Set<string>, depth = 0) {
  if (!value || typeof value !== "object" || depth > 20) return;
  if (Array.isArray(value)) {
    for (const item of value) collectFromObject(item, posts, seen, depth + 1);
    return;
  }

  const obj = value as Record<string, unknown>;
  const legacy = obj.legacy && typeof obj.legacy === "object" ? obj.legacy as Record<string, unknown> : null;
  const source = legacy || obj;
  const text = findString(source, TEXT_KEYS);
  const normalizedText = text ? cleanText(text) : "";

  if (normalizedText && isTweetText(normalizedText)) {
    const id = findString(obj, ID_KEYS) || findString(source, ID_KEYS);
    const time = normalizeTime(findString(source, TIME_KEYS) || findString(obj, TIME_KEYS));
    const key = `${time || ""}:${normalizedText.slice(0, 180)}`;
    if (!seen.has(key)) {
      seen.add(key);
      posts.push({
        external_id: id,
        item_ts: time,
        url: findUrl(source, id) || findUrl(obj, id),
        text: normalizedText,
        raw: value,
      });
    }
  }

  for (const [key, nested] of Object.entries(obj)) {
    if (legacy && key === "legacy") continue;
    collectFromObject(nested, posts, seen, depth + 1);
  }
}

function parseJsonObjects(raw: string): unknown[] {
  try {
    return [JSON.parse(raw)];
  } catch {
    return [];
  }
}

function extractHarPayloads(value: unknown) {
  const payloads: unknown[] = [];
  if (!value || typeof value !== "object") return [value];
  const entries = (value as { log?: { entries?: unknown[] } }).log?.entries;
  if (!Array.isArray(entries)) return [value];
  for (const entry of entries) {
    const text = (entry as { response?: { content?: { text?: unknown } } })?.response?.content?.text;
    if (typeof text !== "string" || !text.trim()) continue;
    try {
      payloads.push(JSON.parse(text));
    } catch {
      // HAR response bodies that are not JSON are usually telemetry, query
      // strings, images, or scripts. Treat user-pasted plain text separately.
    }
  }
  return payloads;
}

function splitPlainText(raw: string): ImportedSerenityPost[] {
  return raw
    .split(/\n\s*(?:---+|={3,})\s*\n|\n{2,}(?=(?:\d{4}-\d{2}-\d{2}|[A-Z]|Still|I\s|Just|Especially|\$))/)
    .map(cleanText)
    .filter((block) => block.length >= 8)
    .map((text) => ({ external_id: null, item_ts: null, url: null, text, raw: { text, import_format: "plain-text" } }));
}

export function extractSerenityPostsFromPayload(raw: string): ImportedSerenityPost[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const roots = parseJsonObjects(trimmed);
  if (roots.length === 0) return splitPlainText(trimmed);

  const posts: ImportedSerenityPost[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const payload of extractHarPayloads(root)) collectFromObject(payload, posts, seen);
  }

  return posts.sort((a, b) => {
    const at = a.item_ts ? new Date(a.item_ts).getTime() : 0;
    const bt = b.item_ts ? new Date(b.item_ts).getTime() : 0;
    return bt - at;
  });
}
