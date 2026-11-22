// ZAHR Veille : balaie les fiches Google du Var, en partant de Puget-Ville, et garde celles sans vrai site.
// Lancé chaque jour par GitHub Actions. Secrets : GOOGLE_PLACES_KEY, NTFY_TOPIC (facultatif).
import { readFile, writeFile } from 'node:fs/promises';
import { score } from './score.mjs';

const HOME = { lat: 43.2896, lng: 6.1361, name: 'Puget-Ville' };
const RADIUS_KM = 110;
// Le Var uniquement : cadre du département + code postal 83 obligatoire.
const VAR_BOX = { s: 42.97, n: 43.83, w: 5.65, e: 6.95 };
const CELL_KM = 12;
const MONTHLY_CAP = +(process.env.MONTHLY_CAP || 950);   // reste sous les 1 000 appels gratuits par mois
const DAILY_CAP = +(process.env.DAILY_CAP || 31);
const KEY = process.env.GOOGLE_PLACES_KEY;
const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);

// « restaurant » en premier : il sert de sonde pour sauter les cases vides (mer, montagne).
export const CATEGORIES = ['restaurant', 'coiffeur', 'barbier', 'institut de beauté', 'onglerie', 'pizzeria',
  'boulangerie pâtisserie', 'traiteur', 'plombier', 'électricien', 'maçon', 'peintre en bâtiment', 'menuisier',
  'paysagiste', 'garage automobile', 'carrosserie', "chambre d'hôtes", 'gîte', 'coach sportif', 'auto-école',
  'toiletteur', 'fleuriste', 'photographe'];

// Plateformes qui ne comptent pas comme un vrai site.
const PLATFORMS = ['facebook.com', 'fb.com', 'instagram.com', 'planity.com', 'fresha.com', 'treatwell', 'pagesjaunes.fr',
  'linktr.ee', 'business.site', 'g.page', 'google.com', 'tiktok.com', 'wixsite.com', 'jimdosite.com', 'site123.me',
  'thefork', 'lafourchette', 'ubereats', 'deliveroo', 'justeat', 'booking.com', 'airbnb', 'gites-de-france', 'leboncoin'];
// Chaînes et franchises : on ne les démarche pas.
const CHAINS = ['mcdonald', 'burger king', 'kfc', 'subway', 'domino', 'pizza hut', 'speed rabbit', "franck provost", 'dessange',
  'jean louis david', 'tchip', 'saint algue', 'camille albane', 'norauto', 'midas', 'speedy', 'feu vert', 'point s', 'ad garage',
  'carglass', 'buffalo grill', 'courtepaille', 'la boucherie', 'hippopotamus', 'del arte', 'flunch', 'boulangerie ange', 'marie blachère',
  'paul ', 'brioche dorée', 'class\'croute', 'yves rocher', 'body minute', 'esthetic center', 'ecf ', 'stuart', 'leclerc', 'carrefour', 'intermarché'];

const toRad = d => d * Math.PI / 180;
export function km(a, b) {
  const R = 6371, dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function cells(sizeKm = CELL_KM) {
  const dLat = sizeKm / 111.2, dLng = sizeKm / (111.2 * Math.cos(toRad(HOME.lat)));
  const n = Math.ceil(RADIUS_KM / sizeKm) + 1, out = [];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const c = { lat: HOME.lat + i * dLat, lng: HOME.lng + j * dLng };
    const d = km(HOME, c); const inVar = c.lat >= VAR_BOX.s && c.lat <= VAR_BOX.n && c.lng >= VAR_BOX.w && c.lng <= VAR_BOX.e;
    if (d <= RADIUS_KM && inVar) out.push({ lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), size: sizeKm, d: Math.round(d) });
  }
  return out.sort((a, b) => a.d - b.d);
}
export function rect(c) {
  const dLat = c.size / 111.2 / 2, dLng = c.size / (111.2 * Math.cos(toRad(c.lat))) / 2;
  return { low: { latitude: c.lat - dLat, longitude: c.lng - dLng }, high: { latitude: c.lat + dLat, longitude: c.lng + dLng } };
}
export function classify(p) {
  const name = (p.displayName?.text || '').toLowerCase();
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return null;
  if (CHAINS.some(c => name.includes(c))) return null;
  if (!/\b83\d{3}\b/.test(p.formattedAddress || '')) return null; // hors Var
  const site = p.websiteUri || '';
  if (!site) return 'sans_site';
  let host = ''; try { host = new URL(site).hostname.toLowerCase(); } catch { return 'sans_site'; }
  if (PLATFORMS.some(x => host.includes(x))) return 'plateforme';
  return null; // vrai site : pas un prospect
}
const FIELDS = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.websiteUri',
  'places.nationalPhoneNumber', 'places.userRatingCount', 'places.priceLevel', 'places.primaryTypeDisplayName', 'places.businessStatus', 'places.googleMapsUri', 'nextPageToken'].join(',');

async function search(q, cell, pageToken) {
  const body = { textQuery: q, languageCode: 'fr', regionCode: 'FR', pageSize: 20, locationRestriction: { rectangle: rect(cell) } };
  if (pageToken) body.pageToken = pageToken;
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': FIELDS }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Google ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
const load = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };

export async function run({ searchFn = search } = {}) {
  const state = await load('data/state.json', null) || { queue: [], usage: {}, emptyCells: [], done: 0 };
  if (!state.queue.length) state.queue = cells().flatMap(c => CATEGORIES.map(q => ({ c, q })));
  const prospects = await load('data/prospects.json', []);
  const known = new Set(prospects.map(p => p.id));
  const seen = new Set(await load('data/seen.json', []));
  state.usage[MONTH] = state.usage[MONTH] || 0;
  let used = 0; const fresh = [];
  const cellKey = c => `${c.lat},${c.lng},${c.size}`;
  const empty = new Set(state.emptyCells);

  while (state.queue.length && used < DAILY_CAP && state.usage[MONTH] < MONTHLY_CAP) {
    const t = state.queue[0];
    if (empty.has(cellKey(t.c))) { state.queue.shift(); continue; }
    let token = null, pages = 0, total = 0;
    do {
      const res = await searchFn(t.q, t.c, token); used++; state.usage[MONTH]++; pages++;
      const list = res.places || []; total += list.filter(p => /\b83\d{3}\b/.test(p.formattedAddress || '')).length;
      for (const p of list) {
        if (seen.has(p.id)) continue; seen.add(p.id);
        const kind = classify(p); if (!kind || known.has(p.id)) continue;
        const loc = { lat: p.location?.latitude, lng: p.location?.longitude };
        const item = { id: p.id, name: p.displayName?.text || '', cat: t.q, type: p.primaryTypeDisplayName?.text || '', address: p.formattedAddress || '',
          lat: loc.lat, lng: loc.lng, km: loc.lat ? Math.round(km(HOME, loc)) : null, phone: p.nationalPhoneNumber || '',
          site: p.websiteUri || '', kind, maps: p.googleMapsUri || '', found: TODAY,
          reviews: p.userRatingCount || 0, price: ({PRICE_LEVEL_INEXPENSIVE:1,PRICE_LEVEL_MODERATE:2,PRICE_LEVEL_EXPENSIVE:3,PRICE_LEVEL_VERY_EXPENSIVE:4})[p.priceLevel] || 0 };
        Object.assign(item, score(item));
        prospects.push(item); known.add(p.id); fresh.push(item);
      }
      token = res.nextPageToken;
    } while (token && pages < 3 && used < DAILY_CAP && state.usage[MONTH] < MONTHLY_CAP);
    state.queue.shift(); state.done++;
    // Case pleine (60 résultats) : on la découpe en 4 pour ne rien rater en ville.
    if (pages === 3 && token && t.c.size > 3) {
      const h = t.c.size / 2, dLat = h / 111.2 / 2, dLng = h / (111.2 * Math.cos(toRad(t.c.lat))) / 2;
      for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) state.queue.unshift({ c: { lat: +(t.c.lat + a * dLat).toFixed(5), lng: +(t.c.lng + b * dLng).toFixed(5), size: h, d: t.c.d }, q: t.q });
    }
    if (t.q === CATEGORIES[0] && total === 0) { empty.add(cellKey(t.c)); }
  }
  state.emptyCells = [...empty];
  state.lastRun = TODAY; state.lastNew = fresh.length; state.remaining = state.queue.length;
  await writeFile('data/state.json', JSON.stringify(state));
  await writeFile('data/seen.json', JSON.stringify([...seen]));
  await writeFile('data/prospects.json', JSON.stringify(prospects, null, 1));
  return { used, fresh, state };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!KEY) { console.error('GOOGLE_PLACES_KEY manquante'); process.exit(1); }
  const { used, fresh, state } = await run();
  const towns = [...new Set(fresh.map(f => (f.address.match(/\d{5}\s+([^,]+)/) || [])[1]).filter(Boolean))].slice(0, 4);
  const hot = fresh.filter(f => f.score >= 70);
  const msg = fresh.length
    ? `${fresh.length} nouveaux prospects, dont ${hot.length} avec un fort besoin : ${towns.join(', ')}. ${state.usage[MONTH]}/${MONTHLY_CAP} appels ce mois.`
    : `Aucun nouveau prospect aujourd'hui. ${state.usage[MONTH]}/${MONTHLY_CAP} appels ce mois.`;
  console.log(msg, `(${used} appels, ${state.remaining} recherches restantes)`);
  if (process.env.NTFY_TOPIC && fresh.length) {
    await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, { method: 'POST', body: msg,
      headers: { Title: 'Veille ZAHR', Tags: 'seedling', Click: process.env.APP_URL || '' } }).catch(() => {});
  }
}
