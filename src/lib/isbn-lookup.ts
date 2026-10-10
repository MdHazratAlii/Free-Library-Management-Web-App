export type IsbnResult = {
  isbn: string;
  title: string;
  author: string;
  pub_year: number | null;
  cover_url: string;
  subjects: string[];
};

export function normalizeIsbn(raw: string): string {
  return (raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

export function isValidIsbn(raw: string): boolean {
  const s = normalizeIsbn(raw);
  if (s.length === 10) {
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      const c = s[i];
      const v = c === "X" && i === 9 ? 10 : Number(c);
      if (Number.isNaN(v)) return false;
      sum += v * (10 - i);
    }
    return sum % 11 === 0;
  }
  if (s.length === 13 && /^\d{13}$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
    return sum % 10 === 0;
  }
  return false;
}

function year(v: unknown): number | null {
  const m = String(v ?? "").match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

async function openLibrary(isbn: string): Promise<IsbnResult | null> {
  const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (!r.ok) return null;
  const j = await r.json();
  const d = j[`ISBN:${isbn}`];
  if (!d?.title) return null;
  return {
    isbn,
    title: d.subtitle ? `${d.title}: ${d.subtitle}` : d.title,
    author: (d.authors || []).map((a: { name: string }) => a.name).join(", "),
    pub_year: year(d.publish_date),
    cover_url: d.cover?.large || d.cover?.medium || "",
    subjects: (d.subjects || []).map((s: { name: string }) => s.name).slice(0, 10),
  };
}

async function googleBooks(isbn: string): Promise<IsbnResult | null> {
  const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  if (!r.ok) return null;
  const j = await r.json();
  const v = j.items?.[0]?.volumeInfo;
  if (!v?.title) return null;
  const img = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "";
  return {
    isbn,
    title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
    author: (v.authors || []).join(", "),
    pub_year: year(v.publishedDate),
    cover_url: img.replace(/^http:/, "https:"),
    subjects: v.categories || [],
  };
}

export async function lookupIsbn(raw: string): Promise<IsbnResult | null> {
  const isbn = normalizeIsbn(raw);
  if (isbn.length !== 10 && isbn.length !== 13) return null;
  for (const src of [openLibrary, googleBooks]) {
    try {
      const res = await src(isbn);
      if (res) return res;
    } catch { /* try next source */ }
  }
  return null;
}

export function matchCategory<T extends { id: number; name: string }>(cats: T[], subjects: string[]): number | null {
  const subs = subjects.map((s) => s.toLowerCase());
  for (const c of cats) {
    const n = c.name.toLowerCase();
    if (subs.some((s) => s.includes(n) || n.includes(s))) return c.id;
  }
  return null;
}
