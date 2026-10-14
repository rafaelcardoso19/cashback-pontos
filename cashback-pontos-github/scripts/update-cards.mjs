import fs from 'node:fs/promises';
import * as cheerio from 'cheerio';

const SOURCE = 'https://www.melhorescartoes.com.br/melhores-cartoes-credito-pontos-milhas';
const FILE = 'index.html';
const MIN_CARDS = 70;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const todayISO = () => new Date().toISOString().slice(0, 10);
const todayBR = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

const ISSUERS = [
  'Banco Industrial do Brasil', 'Banco do Brasil', 'Banco do Nordeste', 'Banco de Brasília',
  'Itaú Personnalité', 'Itaú Uniclass', 'Itaú Private', 'Porto Bank', 'C6 Bank',
  'Banese Card', 'Banco PAN', 'Banco Mercantil', 'Banescard', 'Banpará', 'Banrisul',
  'Bradesco', 'Santander', 'Unicred', 'Sicoob', 'Sicredi', 'Sisprime', 'Cresol',
  'Revolut', 'BTG Pactual', 'Banestes', 'Uniprime', 'Banco Industrial', 'CAIXA',
  'Caixa', 'Safra', 'Nomad', 'Inter', 'Ailos', 'Credicard', 'Daycoval', 'Sofisa',
  'PicPay', 'Nubank', 'Banese', 'BRB', 'XP', 'C6', 'Itaú'
].sort((a, b) => b.length - a.length);

function issuerAndName(title) {
  const value = clean(title).replace(/^\s*\d{1,3}\s*[º°.]\s*/, '');
  const found = ISSUERS.find(issuer => value.toLocaleLowerCase('pt-BR').startsWith(issuer.toLocaleLowerCase('pt-BR') + ' '));
  return found ? { issuer: found, name: value.slice(found.length).trim() } : { issuer: 'Não identificado', name: value };
}
function field(text, regex) {
  const match = text.match(regex);
  return match ? clean(match[1]) : '';
}
function cardBlock($, heading) {
  // Prefer the smallest parent that contains one card heading and the card's key labels.
  for (const ancestor of $(heading).parents().toArray().slice(0, 7)) {
    const node = $(ancestor);
    const text = clean(node.text());
    const h2Count = node.find('h2').length + (node.is('h2') ? 1 : 0);
    if (/anuidade/i.test(text) && /ac[uú]mulo de pontos/i.test(text) && text.length < 2200 && h2Count <= 1) return text;
  }
  // Fallback for pages where a card's information is rendered as following siblings.
  let text = clean($(heading).text());
  let sibling = $(heading).next();
  while (sibling.length && !/^h[1-6]$/i.test(sibling[0].tagName || '')) {
    const piece = clean(sibling.text());
    if (piece) text += ' | ' + piece;
    if (text.length > 2200) break;
    sibling = sibling.next();
  }
  if (!/ac[uú]mulo de pontos/i.test(text)) {
    const parentText = clean($(heading).parent().text());
    if (parentText.length > text.length && parentText.length < 2200) text = parentText;
  }
  return text;
}
function parseCard(title, block, rank) {
  const joined = clean(block);
  if (!/anuidade/i.test(joined) || !/ac[uú]mulo de pontos/i.test(joined)) return null;
  const { issuer, name } = issuerAndName(title);
  const pointsLine = field(joined, /ac[uú]mulo de pontos\s*[:\-]?\s*(.{1,140}?)(?=\s+(?:anuidade|spread|validade|expira|sala vip|acesso|benef[ií]cios)\b|$)/i);
  const nums = [...pointsLine.matchAll(/\d+(?:[,.]\d+)?/g)].map(m => Number(m[0].replace(',', '.'))).filter(Number.isFinite);
  const annualFee = field(joined, /anuidade\s*[:\-]?\s*(R\$\s*[\d.]+(?:,\d{2})?(?:\s*(?:a|–|-)\s*R\$\s*[\d.]+(?:,\d{2})?)?)/i);
  const spread = field(joined, /spread(?: cambial| do d[oó]lar)?\s*[:\-]?\s*(\d+(?:[,.]\d+)?)\s*%/i);
  const expiry = field(joined, /(?:validade dos pontos|pontos)\s*[:\-]?\s*(nunca expiram|não expiram|nao expiram|expiram[^.;|]{0,70})/i);
  const waiverRule = field(joined, /(?:anuidade grátis|anuidade gratis|isen[cç][aã]o(?: da)? anuidade|desconto na anuidade)\s*[:\-]?\s*([^|.]{1,180})/i);
  return {
    rank: String(rank), issuer, name,
    national: nums.length ? String(Math.min(...nums)).replace('.', ',') : '',
    international: nums.length > 1 ? String(Math.max(...nums)).replace('.', ',') : '',
    spread: spread ? spread.replace('.', ',') + '%' : '',
    annualFee, expiry, waiverRule,
    conditions: joined.slice(0, 900),
    source: SOURCE, checkedAt: todayISO(), status: 'source_refresh_needs_validation'
  };
}
function similarity(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let overlap = 0;
  for (const token of A) if (B.has(token)) overlap++;
  return overlap / Math.max(A.size, B.size);
}
function sameIssuer(a, b) {
  const A = norm(a), B = norm(b);
  return A === B || A.startsWith(B + ' ') || B.startsWith(A + ' ');
}

const response = await fetch(SOURCE, {
  headers: { 'user-agent': 'Mozilla/5.0 (compatible; CashbackPontosRefresh/1.0; +https://github.com/)' },
  signal: AbortSignal.timeout(30000)
});
if (!response.ok) throw new Error(`Fonte respondeu HTTP ${response.status}`);
const $source = cheerio.load(await response.text());
let headings = $source('h2').toArray();
let scraped = [];
const seen = new Set();
for (let pass = 0; pass < 2; pass++) {
  const candidates = pass === 0 ? headings : $source('h2,h3,h4').toArray();
  for (const heading of candidates) {
    const title = clean($source(heading).text());
    if (!title || title.length > 140) continue;
    const block = cardBlock($source, heading);
    const card = parseCard(title, block, scraped.length + 1);
    if (!card) continue;
    const key = `${norm(card.issuer)}|${norm(card.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scraped.push(card);
  }
  if (scraped.length >= MIN_CARDS) break;
}
if (scraped.length < MIN_CARDS) {
  throw new Error(`Foram identificados apenas ${scraped.length} cartões. A base não foi alterada para evitar publicar dados incompletos; a estrutura da fonte pode ter mudado.`);
}

let html = await fs.readFile(FILE, 'utf8');
const match = html.match(/const cards = (\[.*?\]);\s*\nconst waiverByName/s);
if (!match) throw new Error('Não localizei a base de cartões no index.html; nada foi alterado.');
const current = JSON.parse(match[1]);
if (scraped.length < current.length * 0.65) {
  throw new Error(`A extração encontrou ${scraped.length} cartões, queda grande em relação aos ${current.length} atuais. Base preservada.`);
}
const used = new Set();
const merged = scraped.map((fresh, idx) => {
  const candidates = current.map((old, oldIndex) => {
    const issuerFit = sameIssuer(old.issuer, fresh.issuer) || fresh.issuer === 'Não identificado';
    const nameScore = similarity(old.name, fresh.name);
    const fullScore = similarity(`${old.issuer} ${old.name}`, `${fresh.issuer} ${fresh.name}`);
    const score = issuerFit ? Math.max(nameScore, fullScore) : fullScore * 0.85;
    return { old, oldIndex, score };
  }).filter(item => !used.has(item.oldIndex)).sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const old = best && best.score >= 0.45 ? best.old : null;
  if (old) used.add(best.oldIndex);
  // Keep curated details when the public page does not expose them clearly.
  return {
    ...(old || {}), ...fresh,
    rank: String(idx + 1),
    issuer: fresh.issuer === 'Não identificado' && old ? old.issuer : fresh.issuer,
    name: fresh.name || old?.name || '',
    national: fresh.national || old?.national || '',
    international: fresh.international || old?.international || '',
    spread: fresh.spread || old?.spread || '',
    annualFee: fresh.annualFee || old?.annualFee || '',
    expiry: fresh.expiry || old?.expiry || '',
    waiverRule: fresh.waiverRule || old?.waiverRule || '',
    benefits: old?.benefits || '',
    allSourceDetails: old?.allSourceDetails || '',
    checkedAt: todayISO(), status: 'source_refresh_needs_validation'
  };
});
html = html.replace(match[0], `const cards = ${JSON.stringify(merged)};\n\nconst waiverByName`);
html = html.replace(/dados consultados em \d{2}\/\d{2}\/\d{4}/i, `dados consultados em ${todayBR()}`);
await fs.writeFile(FILE, html, 'utf8');
console.log(`Atualização concluída: ${scraped.length} cartões extraídos; ${current.length} registros na base anterior; data ${todayBR()}.`);
