/**
 * The sales dashboard's vocabulary: who a lead is, where it is, and how far
 * along the conversation has got. Shared by the page, its actions and the
 * import script.
 */

export const CATEGORIES = [
  { key: "company", label: "Companies", one: "Company" },
  { key: "hotel", label: "Hotels", one: "Hotel" },
  { key: "primary_school", label: "Primary schools", one: "Primary school" },
  { key: "secondary_school", label: "Secondary schools", one: "Secondary school" },
  { key: "university", label: "Universities & colleges", one: "University / college" },
] as const;

export type Category = (typeof CATEGORIES)[number]["key"];
export const isCategory = (v: string): v is Category => CATEGORIES.some((c) => c.key === v);
export const categoryLabel = (key: string) => CATEGORIES.find((c) => c.key === key)?.one ?? key;

export const AREAS = ["Limerick", "Kildare Town", "Clane", "Bray", "Enfield", "Blessington"] as const;
export type Area = (typeof AREAS)[number];
export const isArea = (v: string): v is Area => (AREAS as readonly string[]).includes(v);

/** In the order a lead moves through them. */
export const STATUSES = [
  { key: "new", label: "To contact" },
  { key: "contacted", label: "Contacted" },
  { key: "follow_up", label: "Follow up" },
  { key: "interested", label: "Interested" },
  { key: "won", label: "Signed up" },
  { key: "not_interested", label: "Not interested" },
  { key: "do_not_contact", label: "Do not contact" },
] as const;

export type Status = (typeof STATUSES)[number]["key"];
export const isStatus = (v: string): v is Status => STATUSES.some((s) => s.key === v);
export const statusLabel = (key: string) => STATUSES.find((s) => s.key === key)?.label ?? key;

/** What the list shows for every lead. */
export type LeadRow = {
  id: string;
  name: string;
  category: Category;
  area: Area;
  town: string | null;
  phone: string | null;
  email: string | null;
  status: Status;
  follow_up_on: string | null;
  last_contact_at: string | null;
  distance_km: number | null;
  contact_name: string | null;
};

/** Everything else, loaded when a lead is opened. */
export type LeadDetail = LeadRow & {
  address: string | null;
  eircode: string | null;
  website: string | null;
  contact_role: string | null;
  size: string | null;
  sector: string | null;
  source: string | null;
  notes: string | null;
};

export type Activity = {
  id: string;
  kind: "call" | "email" | "meeting" | "note" | "status";
  body: string | null;
  author_email: string;
  created_at: string;
};

export const LEAD_LIST_COLUMNS =
  "id, name, category, area, town, phone, email, status, follow_up_on, last_contact_at, distance_km, contact_name";
export const LEAD_DETAIL_COLUMNS = `${LEAD_LIST_COLUMNS}, address, eircode, website, contact_role, size, sector, source, notes`;

/**
 * An Irish number written the way people read it out: "061 229 011",
 * "01 234 5678", "087 123 4567". Anything that isn't recognisably Irish is
 * left as it was.
 */
export function formatPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // "+00 353 …" turns up too: an international prefix written twice.
  let d = raw.replace(/[^\d+]/g, "").replace(/^\+00/, "00");
  if (d.startsWith("+353")) d = "0" + d.slice(4);
  else if (d.startsWith("00353")) d = "0" + d.slice(5);
  else if (d.startsWith("353") && d.length >= 11) d = "0" + d.slice(3);
  d = d.replace(/^0+(?=0)/, "");
  if (!/^0\d{6,10}$/.test(d)) return raw.trim();
  if (d.startsWith("01")) return `01 ${d.slice(2, 5)} ${d.slice(5)}`;
  if (/^08\d/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  // Four-figure codes, such as Wicklow's 0404 and Tullamore's 0506.
  if (/^0(40[1-4]|50[4-9])/.test(d)) return `${d.slice(0, 4)} ${d.slice(4)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

/** A number a phone can dial: "tel:+35361229011". */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return `tel:${d}`;
  if (d.startsWith("0")) return `tel:+353${d.slice(1)}`;
  return `tel:${d}`;
}

export function websiteHref(site: string | null): string | null {
  if (!site) return null;
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}
