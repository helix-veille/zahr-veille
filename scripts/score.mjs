// Note de pertinence : ce commerce a-t-il vraiment besoin d'un site ? (0 à 100, sans tokens)
// Secteur (besoin de réserver, commander, demander un devis) + taille et activité + présence en ligne + tourisme.
export const SECTOR = {
  "chambre d'hôtes": [38, 'les clients réservent en ligne avant de venir'], 'gîte': [38, 'les clients réservent en ligne avant de venir'],
  'photographe': [36, 'on choisit un photographe sur son portfolio'],
  'coiffeur': [34, 'la prise de rendez-vous en ligne est devenue la norme'], 'institut de beauté': [34, 'la prise de rendez-vous en ligne est devenue la norme'],
  'barbier': [32, 'clientèle jeune qui réserve sur téléphone'], 'restaurant': [32, 'les clients regardent la carte et réservent en ligne'],
  'paysagiste': [32, 'les devis se demandent en ligne, avec photos de réalisations'], 'coach sportif': [32, 'les séances se réservent en ligne'],
  'pizzeria': [30, 'la commande à emporter en ligne fait gagner du temps au rush'], 'traiteur': [30, 'les commandes de fêtes et d’événements se préparent en ligne'],
  'plombier': [30, 'les urgences et les devis arrivent par Google'], 'maçon': [30, 'les devis se demandent en ligne, avec photos de chantiers'],
  'menuisier': [30, 'un portfolio de réalisations rassure avant un devis'], 'auto-école': [30, 'inscriptions et tarifs consultés en ligne'],
  'électricien': [28, 'les urgences et les devis arrivent par Google'], 'onglerie': [28, 'la prise de rendez-vous en ligne est devenue la norme'],
  'toiletteur': [28, 'les rendez-vous se prennent en ligne'], 'peintre en bâtiment': [26, 'un portfolio de chantiers rassure avant un devis'],
  'fleuriste': [24, 'commandes pour les fêtes et les deuils'], 'garage automobile': [22, 'rendez-vous atelier et devis en ligne'],
  'carrosserie': [22, 'devis avec photos des dégâts'], 'boulangerie pâtisserie': [14, 'surtout utile pour les commandes de gâteaux'],
};
const TOURIST = ['hyères','bormes','lavandou','saint-tropez','sainte-maxime','fréjus','saint-raphaël','sanary','bandol','six-fours','cavalaire',
  'ramatuelle','grimaud','cogolin','porquerolles','le pradet','carqueiranne','croix-valmer','gassin','saint-cyr','la cadière','le castellet',
  'aups','moustiers','bauduen','les salles-sur-verdon','tourtour','cotignac','seillans','fayence','ollioules','rayol'];
const TOURIST_CATS = ['restaurant','pizzeria',"chambre d'hôtes",'gîte','coach sportif','photographe','barbier','institut de beauté'];

export function score(p) {
  const why = []; let s = 0;
  const [w, reason] = SECTOR[p.cat] || [24, ''];
  s += w; if (w >= 30 && reason) why.push(`Secteur : ${reason}`); else if (w < 20) why.push('Secteur où le site compte moins (clientèle de passage et d’habitués)');
  const n = +p.reviews || 0;
  if (n >= 200) { s += 25; why.push('Commerce très actif : beaucoup de clients, donc les moyens d’investir'); }
  else if (n >= 50) { s += 22; why.push('Commerce bien installé, avec une vraie clientèle'); }
  else if (n >= 10) s += 15;
  else if (n >= 5) s += 5;
  else { s -= 10; why.push('Très petit ou tout récent : budget incertain'); }
  if (p.kind === 'sans_site') { s += 20; why.push('Aucun site relié à sa fiche Google : il perd les clients qui cherchent en ligne'); }
  else if (/planity|fresha|treatwell/i.test(p.site || '')) { s += 18; why.push('Dépend de Planity ou Fresha (commissions, clients qui ne sont pas à lui)'); }
  else { s += 15; why.push('Renvoie seulement vers Facebook ou Instagram : pas de site à son nom'); }
  const t = (p.address || '').toLowerCase();
  if (TOURIST.some(x => t.includes(x))) { const b = TOURIST_CATS.includes(p.cat) ? 10 : 5; s += b; if (b === 10) why.push('Zone touristique : clientèle qui découvre et réserve en ligne'); }
  if (p.price >= 3) { s += 5; why.push('Positionnement haut de gamme'); }
  s = Math.max(0, Math.min(100, s));
  const verdict = s >= 70 ? 'Fort besoin' : s >= 50 ? 'Besoin moyen' : 'Faible besoin';
  return { score: s, verdict, reasons: why.slice(0, 3) };
}
