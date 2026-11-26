// ZAHR Contact : prend les prospects trouvés par la veille et les contacte.
//  1. Adresse e-mail trouvée  -> e-mail personnalisé envoyé AUTOMATIQUEMENT depuis contact.zahrdigital@gmail.com
//  2. Sinon Instagram trouvé  -> notification ntfy avec bouton « Instagram » (envoi en un geste)
//  3. Sinon mobile (06/07)    -> notification ntfy avec bouton « WhatsApp » (message déjà écrit)
//  4. Sinon                   -> notification ntfy « à contacter à la main » (téléphone + fiche Google)
// Secrets GitHub : GMAIL_APP_PASSWORD (mot de passe d'application Gmail), NTFY_TOPIC.
// Journal : data/contacts.json (personne n'est contacté deux fois). Désinscrits : data/optout.json.
import { readFile, writeFile } from 'node:fs/promises';

const ZONE_CP = ['83400', '83320', '83220', '83260', '83130', '83250'];
const FROM = 'contact.zahrdigital@gmail.com';
const MIN_SCORE = +(process.env.MIN_SCORE || 60);
const EMAIL_CAP = +(process.env.EMAIL_CAP || 15);   // e-mails par jour (protège la réputation du compte Gmail)
const NOTIF_CAP = +(process.env.NOTIF_CAP || 10);   // notifications par jour
const DRY = process.env.DRY_RUN === '1';
const TODAY = new Date().toISOString().slice(0, 10);
const SITE = 'https://zahr.fr';
const INSTA = 'https://www.instagram.com/zahr.digital/';
const SIREN = '133 187 070';

const load = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
export const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const city = a => ((a || '').match(/\b83\d{3}\s+([^,]+)/) || [])[1]?.trim() || '';

// Ce que ZAHR peut apporter, selon le métier (phrases vraies et neutres, sans chiffre ni promesse).
const ANGLES = [
  [/coiff|barb|institut|beaut|ongl|esth|coach|auto.?ecole|toilett|photo/, 'Un site avec prise de rendez-vous en ligne permettrait à vos clients de réserver à toute heure, sans avoir à vous appeler.'],
  [/restau|pizz|traiteur|boulang|patiss|bar|cafe/, 'Un site avec votre carte, vos horaires et la réservation (ou la commande) en ligne permettrait à vos clients de vous choisir avant même de se déplacer.'],
  [/chambre|gite|hote|heberg/, 'Un site avec réservation directe permettrait à vos voyageurs de réserver chez vous sans passer par une plateforme.'],
  [/plomb|electr|macon|peint|menuis|paysag|garage|carross|fleur|couvreur|artisan/, 'Un site avec vos réalisations et une demande de devis en ligne permettrait aux clients qui vous cherchent de vous contacter directement.'],
];
export function angle(p) {
  const k = norm(`${p.cat} ${p.type}`);
  return (ANGLES.find(([re]) => re.test(k)) || [, 'Un site à votre nom, avec un moyen simple de vous contacter ou de réserver, permettrait aux clients qui vous cherchent en ligne de vous trouver.'])[1];
}
export function constat(p) {
  return p.kind === 'sans_site'
    ? `j'ai vu que la fiche Google de ${p.name} ne renvoie vers aucun site`
    : `j'ai vu que la fiche Google de ${p.name} renvoie seulement vers une page ${platformName(p.site)}, pas vers un site à votre nom`;
}
function platformName(u) {
  const h = (() => { try { return new URL(u).hostname; } catch { return ''; } })();
  for (const [k, v] of [['facebook', 'Facebook'], ['fb.com', 'Facebook'], ['instagram', 'Instagram'], ['planity', 'Planity'], ['fresha', 'Fresha'],
    ['wix', 'Wix'], ['jimdo', 'Jimdo'], ['linktr', 'Linktree'], ['business.site', 'Google'], ['pagesjaunes', 'PagesJaunes']]) if (h.includes(k)) return v;
  return 'de plateforme';
}

export function emailText(p, source) {
  const subject = `Un site à votre nom pour ${p.name} ?`;
  const body = `Bonjour,

Je suis Redha, je crée des sites web sur mesure dans le Var avec ZAHR.

En cherchant les commerces de ${city(p.address) || 'votre ville'}, ${constat(p)}. ${angle(p)}

Vous pouvez voir mon travail ici :
- Site : ${SITE}
- Instagram : ${INSTA}

Si ça vous intéresse, répondez simplement à ce message et je vous prépare une proposition, sans engagement.

Redha – ZAHR · zahr.fr

—
Vous recevez ce message parce que cette adresse professionnelle est publiée sur ${source}. Pour ne plus recevoir de message de ZAHR, répondez simplement « STOP ». ZAHR, micro-entreprise, SIREN ${SIREN}.`;
  return { subject, body };
}
export function dmText(p) {
  return `Bonjour, je suis Redha, je crée des sites web sur mesure dans le Var avec ZAHR.

${constat(p).replace(/^j'ai vu/, "J'ai vu")}. ${angle(p)}

Mon travail : ${SITE} et ${INSTA}

Si ça vous intéresse, répondez simplement ici, c'est sans engagement. Si non, dites-le-moi et je ne vous recontacterai pas.

Redha – ZAHR`;
}

// ---- Recherche des contacts (gratuite) ----
const BAD_MAIL = /(example|sentry|wixpress|wix\.com|domain\.|email\.com|\.(png|jpe?g|gif|webp|svg)$|noreply|no-reply)/i;
export function emailsIn(html) {
  const out = new Set();
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) out.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of html.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) out.add(m[0].toLowerCase());
  return [...out].filter(e => !BAD_MAIL.test(e) && e.length < 80);
}
export function instagramOf(url) {
  const m = (url || '').match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  return m && !['p', 'reel', 'explore', 'accounts'].includes(m[1].toLowerCase()) ? m[1] : '';
}
export function mobileOf(phone) {
  const d = (phone || '').replace(/\D/g, '').replace(/^33/, '0');
  return /^0[67]\d{8}$/.test(d) ? d : '';
}
async function fetchText(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 (ZAHR veille)', 'Accept-Language': 'fr' } });
    return r.ok ? (await r.text()).slice(0, 800000) : '';
  } catch { return ''; }
}
export async function findContacts(p, get = fetchText) {
  const c = { email: '', emailSource: '', instagram: instagramOf(p.site), mobile: mobileOf(p.phone) };
  const site = p.site || '';
  // Facebook et Instagram demandent une connexion : on ne les lit pas.
  if (site && !/facebook|fb\.com|instagram|google\.|g\.page/i.test(site)) {
    const base = site.replace(/\/$/, '');
    for (const u of [site, `${base}/contact`, `${base}/contact-us`]) {
      const html = await get(u); if (!html) continue;
      if (!c.instagram) for (const m of html.matchAll(/instagram\.com\/([A-Za-z0-9._]+)/gi)) { const h = instagramOf(m[0]); if (h) { c.instagram = h; break; } }
      const mails = emailsIn(html);
      if (mails.length) { c.email = mails[0]; c.emailSource = `sa page ${platformName(site)} (${new URL(u).hostname})`; break; }
    }
  }
  return c;
}

// ---- Envoi ----
async function ntfy(o) {
  if (!process.env.NTFY_TOPIC || DRY) { console.log('[ntfy]', o.title); return true; }
  const r = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: process.env.NTFY_TOPIC, ...o }) }).catch(() => null);
  return !!r?.ok;
}
let transport;
async function sendMail(to, { subject, body }) {
  if (DRY) { console.log('[mail]', to, subject); return true; }
  if (!transport) {
    const nm = (await import('nodemailer')).default;
    transport = nm.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: FROM, pass: process.env.GMAIL_APP_PASSWORD } });
  }
  await transport.sendMail({ from: `Redha · ZAHR <${FROM}>`, to, subject, text: body, replyTo: FROM,
    headers: { 'List-Unsubscribe': `<mailto:${FROM}?subject=STOP>` } });
  return true;
}

export async function run({ get = fetchText } = {}) {
  const prospects = await load('data/prospects.json', []);
  const log = await load('data/contacts.json', {});
  const optout = new Set((await load('data/optout.json', [])).map(s => s.toLowerCase()));
  // Clients et prospects déjà en discussion avec Redha : jamais contactés par le robot.
  const exclude = (await load('data/exclude.json', [])).map(norm).filter(Boolean);
  const excluded = p => exclude.some(x => norm(p.name).includes(x));
  // Prospects déjà contactés à la main par Redha (tournée du jour) : on ne les recontacte pas.
  let tournee = [];
  try { const r = await fetch(`https://raw.githubusercontent.com/helix-veille/zahr-site/main/t-8m3qzk/tournee.json?x=${Date.now()}`); if (r.ok) tournee = await r.json(); } catch {}
  const done = new Set(tournee.filter(t => t.sent).map(t => norm(t.name)));
  const canMail = !!process.env.GMAIL_APP_PASSWORD || DRY;

  const todo = prospects
    .filter(p => !log[p.id] && p.score >= MIN_SCORE && ZONE_CP.some(cp => (p.address || '').includes(cp)) && !done.has(norm(p.name)) && !optout.has(norm(p.name)) && !excluded(p))
    .sort((a, b) => b.score - a.score || (b.found || '').localeCompare(a.found || ''));

  let mails = 0, notifs = 0; const report = [];
  for (const p of todo) {
    if (mails >= EMAIL_CAP && notifs >= NOTIF_CAP) break;
    const c = await findContacts(p, get);
    const where = `${p.name} (${city(p.address)})`;
    if (c.email && !optout.has(c.email) && canMail) {
      if (mails >= EMAIL_CAP) continue;
      try {
        await sendMail(c.email, emailText(p, c.emailSource));
        log[p.id] = { name: p.name, city: city(p.address), date: TODAY, via: 'email', to: c.email, auto: true };
        mails++; report.push(`✉️ ${where} → ${c.email}`);
      } catch (e) { console.error('E-mail refusé pour', where, e.message); }
      continue;
    }
    if (notifs >= NOTIF_CAP) continue;
    const msg = dmText(p);
    const actions = [];
    let via, title;
    if (c.instagram) { via = 'instagram'; title = `Instagram : ${where}`; actions.push({ action: 'view', label: 'Instagram', url: `https://ig.me/m/${c.instagram}` }); }
    else if (c.mobile) { via = 'whatsapp'; title = `WhatsApp : ${where}`; actions.push({ action: 'view', label: 'WhatsApp', url: `https://wa.me/33${c.mobile.slice(1)}?text=${encodeURIComponent(msg)}` }); }
    else { via = 'manuel'; title = `À contacter à la main : ${where}`; if (p.phone) actions.push({ action: 'view', label: 'Appeler', url: `tel:${p.phone.replace(/\s/g, '')}` }); }
    if (c.instagram && c.mobile) actions.push({ action: 'view', label: 'WhatsApp', url: `https://wa.me/33${c.mobile.slice(1)}?text=${encodeURIComponent(msg)}` });
    if (p.maps) actions.push({ action: 'view', label: 'Fiche Google', url: p.maps });
    const extra = c.email && !canMail ? `\n\n(E-mail trouvé : ${c.email} — il partira tout seul dès que GMAIL_APP_PASSWORD sera dans GitHub.)` : '';
    const ok = await ntfy({ title, message: `${p.type || p.cat} · ${p.phone || 'pas de téléphone'} · ${p.score}/100\n\nMessage à envoyer :\n${msg}${extra}`,
      tags: [via === 'manuel' ? 'telephone_receiver' : 'speech_balloon'], priority: 4, actions: actions.slice(0, 3), click: actions[0]?.url || p.maps });
    if (ok) {
      log[p.id] = { name: p.name, city: city(p.address), date: TODAY, via, to: c.instagram || c.mobile || p.phone || '', auto: false, ...(c.email ? { email: c.email } : {}) };
      notifs++; report.push(`🔔 ${where} → ${via}${c.instagram ? ' @' + c.instagram : ''}`);
    }
  }
  if (!DRY) await writeFile('data/contacts.json', JSON.stringify(log, null, 1));
  const left = todo.length - mails - notifs;
  const sum = `Contacts ZAHR : ${mails} e-mail(s) envoyé(s) automatiquement, ${notifs} à envoyer en un geste. ${Math.max(left, 0)} prospect(s) en attente.`;
  console.log(sum + '\n' + report.join('\n'));
  if (mails + notifs) await ntfy({ title: 'Contacts ZAHR du jour', message: sum + '\n' + report.join('\n'), tags: ['seedling'] });
  return { mails, notifs, report, log };
}

if (import.meta.url === `file://${process.argv[1]}`) await run();
