const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const CONFIG = {
  REFI_RATE_NEW: 0.043,
  REFI_YEARS_MAX: 28,
  CONSOLIDATION_RATE: 0.089,
  CONSOLIDATION_YEARS: 7,
  CONSOLIDATION_DEFERRAL_MONTHS: 6,
  DTI_CRITICAL: 0.6,
  DTI_HIGH: 0.45,
  DTI_MEDIUM: 0.3,
  AI_DELAY_MIN_MS: 2000,
  AI_DELAY_MAX_MS: 3000,
  PORT: process.env.PORT || 3000,
};

const app = express();
app.use(cors());
app.use(express.json());

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Keboola health check — must be the first route
app.post('/', (req, res) => {
  res.status(200).send('OK');
});

// Structured JSON request logger middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const entry = JSON.stringify({
      time: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
      body: req.method === 'POST' ? req.body : undefined,
    });
    fs.appendFileSync(path.join(LOG_DIR, 'app.log'), entry + '\n');
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Static demo data for Radek Špaček scenario
const RADEK_SPACEK_DEMO = {
  life_story: 'Jmenuji se Radek Špaček, je mi 42 let a pracuji jako IT team lead. Vše začalo nevinnou sázkou s kolegou Honzou — vsadili jsme se o 5 000 Kč, jestli na bleším trhu koupím kajak. Kajak jsem koupil za 2 000 Kč, ale pak jsem investoval dalších 42 000 Kč do jeho renovace, protože to přece bude stát za to. Při prvním spuštění na Vltavě jsem převrátil turistický šlapadlový člun a musel zaplatit škody 29 000 Kč, plus mi utopil telefon. Mezitím můj bengálský kocour Kotelna prokousl napájecí kabely firemního MacBooku — IT oddělení mě donutilo zaplatit náhradu 38 000 Kč. Pak jsem viděl inzerát na luxusní rekonstrukci bytu se slevou 70 % — byl to podvod a přišel jsem o 82 000 Kč. Tentýž týden auto potřebovalo nové motory, protože jsem ho jezdil bez oleje — myslel jsem, že pipání je jen senzorová chyba. Oprava stála 57 000 Kč. Vše jsem řešil rychlými spotřebními půjčkami. Teď mi zbývá tak 6 200 Kč měsíčně.',
  incomes: [
    { type: 'zaměstnání', description: 'IT team lead', monthly_net: 52000 },
    { type: 'pronájem', description: 'Podnájem pokoje', monthly_net: 8500 },
  ],
  assets: [
    { description: 'Kajak (renovovaný)', estimated_value: 8000, willing_to_sell: true },
    { description: 'Osobní automobil', estimated_value: 85000, willing_to_sell: true },
  ],
  debts: [
    { type: 'hypotéka', bank: 'Komerční banka', balance: 2450000, rate: 5.9, monthly_payment: 16591 },
    { type: 'spotřební úvěr', bank: 'Creditas', balance: 145000, rate: 12.4, monthly_payment: 5200 },
    { type: 'spotřební úvěr', bank: 'ČSOB', balance: 85000, rate: 14.9, monthly_payment: 4100 },
    { type: 'rychlá půjčka', bank: 'Air Bank', balance: 178000, rate: 18.9, monthly_payment: 6800 },
    { type: 'kreditní karta', bank: 'Česká spořitelna', balance: 38000, rate: 22.0, monthly_payment: 3100 },
    { type: 'kreditní karta', bank: 'Zonky', balance: 26000, rate: 24.9, monthly_payment: 2400 },
  ],
  expenses: [
    { category: 'jídlo', monthly_amount: 8000 },
    { category: 'energie', monthly_amount: 3500 },
    { category: 'doprava', monthly_amount: 2800 },
    { category: 'jiné', monthly_amount: 4200 },
  ],
};

// GET /api/solution-finder/demo — returns static Radek Špaček demo data
app.get('/api/solution-finder/demo', (req, res) => {
  res.json(RADEK_SPACEK_DEMO);
});

// POST /api/solution-finder/ai-analyze — fake AI analysis with 2-3s delay
app.post('/api/solution-finder/ai-analyze', async (req, res) => {
  const { life_story, incomes, debts, expenses, assets } = req.body;
  if (!life_story || !Array.isArray(incomes) || !Array.isArray(debts)) {
    return res.status(400).json({ error: 'Missing required fields: life_story, incomes, debts' });
  }
  try {
    const result = await simulateAI({
      life_story,
      incomes,
      assets: assets || [],
      debts,
      expenses: expenses || [],
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// Pure function: calculates monthly annuity payment
function calcMonthlyPayment(principal, annualRate, years) {
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// Pure function: classifies DTI ratio into severity bucket
function classifyDTI(dti) {
  if (dti >= CONFIG.DTI_CRITICAL) return 'critical';
  if (dti >= CONFIG.DTI_HIGH) return 'high';
  if (dti >= CONFIG.DTI_MEDIUM) return 'medium';
  return 'low';
}

// Pure function: generates full financial analysis from structured input
function generateAnalysis(data) {
  const { life_story, incomes, assets, debts, expenses } = data;

  const total_income = incomes.reduce((s, i) => s + (i.monthly_net || 0), 0);
  const total_debt_payments = debts.reduce((s, d) => s + (d.monthly_payment || 0), 0);
  const total_expenses = expenses.reduce((s, e) => s + (e.monthly_amount || 0), 0);
  const dti = total_income > 0 ? total_debt_payments / total_income : 0;
  const remaining = total_income - total_debt_payments - total_expenses;

  const severity = classifyDTI(dti);
  const severityLabels = { critical: 'Kritická', high: 'Vysoká', medium: 'Střední', low: 'Nízká' };
  const health_score = Math.round(Math.max(0, Math.min(100, 100 - dti * 130)));

  const recommendations = [];
  let total_monthly_relief = 0;
  let projected_debt_payments = total_debt_payments;

  // Recommendation 1: Mortgage refinancing
  const mortgages = debts.filter(d => d.type === 'hypotéka');
  if (mortgages.length > 0) {
    const m = mortgages[0];
    const newPayment = Math.round(calcMonthlyPayment(m.balance, CONFIG.REFI_RATE_NEW, CONFIG.REFI_YEARS_MAX));
    const saving = m.monthly_payment - newPayment;
    if (saving > 0) {
      recommendations.push({
        id: 'mortgage-refi',
        priority: dti > CONFIG.DTI_CRITICAL ? 'urgent' : 'high',
        product: 'Refinancování hypotéky',
        current_terms: `${m.rate} % p.a., splátka ${m.monthly_payment.toLocaleString('cs-CZ')} Kč/měs.`,
        proposed_change: `Snížení sazby na ${CONFIG.REFI_RATE_NEW * 100} %, prodloužení na ${CONFIG.REFI_YEARS_MAX} let`,
        monthly_saving: saving,
        one_time_note: 'Poplatek za refinancování cca 5 000 Kč',
        action_label: 'Zahájit refinancování',
      });
      total_monthly_relief += saving;
      projected_debt_payments -= saving;
    }
  }

  // Recommendation 2: Consolidation of non-mortgage debts
  const nonMortgage = debts.filter(d => d.type !== 'hypotéka');
  if (nonMortgage.length >= 2) {
    const consolidation_balance = nonMortgage.reduce((s, d) => s + d.balance, 0);
    const old_payments = nonMortgage.reduce((s, d) => s + d.monthly_payment, 0);
    const new_payment = Math.round(
      calcMonthlyPayment(consolidation_balance, CONFIG.CONSOLIDATION_RATE, CONFIG.CONSOLIDATION_YEARS)
    );
    const saving = old_payments - new_payment;
    const deferralNote =
      dti > CONFIG.DTI_HIGH ? ` + ${CONFIG.CONSOLIDATION_DEFERRAL_MONTHS} měs. odklad splátek` : '';
    if (saving > 0) {
      recommendations.push({
        id: 'consolidation',
        priority: dti > CONFIG.DTI_CRITICAL ? 'urgent' : 'high',
        product: `Konsolidace ${nonMortgage.length} závazků`,
        current_terms: `${nonMortgage.length} různých úvěrů, celkem ${old_payments.toLocaleString('cs-CZ')} Kč/měs.`,
        proposed_change: `Sloučení do 1 úvěru @ ${CONFIG.CONSOLIDATION_RATE * 100} % / ${CONFIG.CONSOLIDATION_YEARS} let${deferralNote}`,
        monthly_saving: saving,
        one_time_note: `Konsolidovaná částka: ${consolidation_balance.toLocaleString('cs-CZ')} Kč`,
        action_label: 'Sjednat konsolidaci',
      });
      total_monthly_relief += saving;
      projected_debt_payments -= saving;
    }
  }

  // Recommendation 3: Asset sales — apply proceeds to highest-rate debts first
  const sellableAssets = assets.filter(a => a.willing_to_sell && a.estimated_value > 0);
  const debtsByRate = [...nonMortgage].sort((a, b) => b.rate - a.rate);
  for (const asset of sellableAssets) {
    let remaining_proceeds = asset.estimated_value;
    const freed_payments = [];
    for (const d of debtsByRate) {
      if (remaining_proceeds >= d.balance) {
        freed_payments.push(d.monthly_payment);
        remaining_proceeds -= d.balance;
      }
    }
    const freed = freed_payments.reduce((s, p) => s + p, 0);
    if (freed > 0) {
      recommendations.push({
        id: `asset-${asset.description.toLowerCase().replace(/\s+/g, '-')}`,
        priority: 'medium',
        product: `Prodej: ${asset.description}`,
        current_terms: `Odhadovaná hodnota: ${asset.estimated_value.toLocaleString('cs-CZ')} Kč`,
        proposed_change: `Jednorázové umoření nejdražších dluhů, uvolnění ${freed.toLocaleString('cs-CZ')} Kč/měs.`,
        monthly_saving: freed,
        one_time_note: null,
        action_label: 'Zahájit prodej',
      });
      total_monthly_relief += freed;
      projected_debt_payments -= freed;
    }
  }

  const projected_dti =
    total_income > 0 ? Math.max(0, projected_debt_payments) / total_income : 0;

  // Extract key events from life story (sentences > 30 chars, first 4)
  const sentences = (life_story || '')
    .split(/[.!?]/)
    .map(s => s.trim())
    .filter(s => s.length > 30);
  const key_events = sentences.slice(0, 4);

  const narrative =
    `Na základě analýzy Vaší finanční situace jsme identifikovali ${severity === 'critical' ? 'kritické' : severity === 'high' ? 'závažné' : 'středně závažné'} zadlužení s poměrem splácení k příjmu ${(dti * 100).toFixed(1)} %. Vaše měsíční závazky dosahují ${total_debt_payments.toLocaleString('cs-CZ')} Kč při čistém příjmu ${total_income.toLocaleString('cs-CZ')} Kč, což Vám ponechává pouze ${remaining.toLocaleString('cs-CZ')} Kč na běžné životní náklady.\n\nDoporučujeme realizovat navrhovaná opatření v pořadí podle priority. Klíčovým krokem je ${recommendations[0] ? recommendations[0].product.toLowerCase() : 'restrukturalizace závazků'}, které Vám ušetří nejvíce prostředků. Po realizaci všech doporučení se Váš DTI sníží na ${(projected_dti * 100).toFixed(1)} % a měsíční úspora dosáhne ${total_monthly_relief.toLocaleString('cs-CZ')} Kč.\n\nDoporučujeme co nejdříve kontaktovat Vašeho finančního poradce a zahájit kroky s nejvyšší prioritou. Situace je řešitelná — klíčem je jednat systematicky a bez zbytečných prodlev.`;

  return {
    severity,
    severity_label: severityLabels[severity],
    health_score,
    current_dti: Math.round(dti * 1000) / 1000,
    projected_dti: Math.round(projected_dti * 1000) / 1000,
    key_events,
    recommendations,
    total_monthly_relief,
    narrative,
  };
}

// Async wrapper that simulates AI processing delay before running analysis
async function simulateAI(data) {
  const delay =
    CONFIG.AI_DELAY_MIN_MS + Math.random() * (CONFIG.AI_DELAY_MAX_MS - CONFIG.AI_DELAY_MIN_MS);
  await new Promise(resolve => setTimeout(resolve, delay));
  return generateAnalysis(data);
}

// ─── Branch Reporter demo data ─────────────────────────────────────────────────
const BRANCH_DEMO = {
  branch: { name: 'Praha 1 – Václavské náměstí', bank: 'Česká spořitelna, a.s.', currentMonth: 'Duben 2026', daysInMonth: 30, daysCurrent: 14, daysRemaining: 16 },
  manager: { id: 0, name: 'Ing. Radka Vlčková', initials: 'RV' },
  products: [
    { id: 'hyp',      name: 'Hypotéka',          commissionPerUnit: 6500 },
    { id: 'consumer', name: 'Spotřební úvěr',     commissionPerUnit: 1400 },
    { id: 'cc',       name: 'Kreditní karta',      commissionPerUnit: 350  },
    { id: 'pension',  name: 'Penzijní spoření',    commissionPerUnit: 650  },
    { id: 'stav',     name: 'Stavební spoření',    commissionPerUnit: 720  },
    { id: 'invest',   name: 'Investiční fondy',    commissionPerUnit: 1800 },
    { id: 'life_ins', name: 'Životní pojištění',   commissionPerUnit: 2400 },
    { id: 'prop_ins', name: 'Pojištění majetku',   commissionPerUnit: 750  },
    { id: 'account',  name: 'Běžný účet',          commissionPerUnit: 220  },
    { id: 'biz_loan', name: 'Podnikatelský úvěr',  commissionPerUnit: 8500 },
  ],
  tiers: [
    { id: 'none',     label: 'Bez bonusu', minPct: 0,     maxPct: 0.699, multiplier: 1.0, color: '#9E9E9E' },
    { id: 'silver',   label: 'Stříbro',   minPct: 0.70,   maxPct: 0.899, multiplier: 1.2, color: '#7A8FA6' },
    { id: 'gold',     label: 'Zlato',     minPct: 0.90,   maxPct: 1.099, multiplier: 1.5, color: '#C8A430' },
    { id: 'platinum', label: 'Platina',   minPct: 1.10,   maxPct: 1.249, multiplier: 1.8, color: '#5B8DEF' },
    { id: 'diamond',  label: 'Diamant',   minPct: 1.25,   maxPct: 99,    multiplier: 2.2, color: '#9B59B6' },
  ],
  teamBonuses: { branchOnTarget: 5000, bestSeller: 3000, crossSellPerClient: 500, crossSellThreshold: 3 },
  employees: [
    { id: 1, name: 'Petra Nováková',   initials: 'PN', role: 'Senior finanční poradce',    crossSellRate: 3.4, clientsWithCrossSell: 19, weeklyEarned: [31200, 36610, 0, 0],
      products: { hyp:{sold:2,target:2}, consumer:{sold:7,target:7}, cc:{sold:11,target:14}, pension:{sold:5,target:6}, stav:{sold:5,target:5}, invest:{sold:4,target:4}, life_ins:{sold:5,target:5}, prop_ins:{sold:5,target:6}, account:{sold:13,target:15}, biz_loan:{sold:1,target:1} } },
    { id: 2, name: 'Tomáš Dvořák',    initials: 'TD', role: 'Hypoteční specialista',       crossSellRate: 4.1, clientsWithCrossSell: 16, weeklyEarned: [36900, 42550, 0, 0],
      products: { hyp:{sold:5,target:4}, consumer:{sold:5,target:4}, cc:{sold:10,target:8}, pension:{sold:4,target:3}, stav:{sold:3,target:3}, invest:{sold:5,target:4}, life_ins:{sold:4,target:3}, prop_ins:{sold:4,target:3}, account:{sold:10,target:8}, biz_loan:{sold:1,target:1} } },
    { id: 3, name: 'Jana Horáčková',  initials: 'JH', role: 'Finanční poradce',            crossSellRate: 2.9, clientsWithCrossSell: 8,  weeklyEarned: [22100, 31270, 0, 0],
      products: { hyp:{sold:1,target:2}, consumer:{sold:5,target:7}, cc:{sold:11,target:14}, pension:{sold:5,target:6}, stav:{sold:4,target:5}, invest:{sold:3,target:3}, life_ins:{sold:4,target:5}, prop_ins:{sold:5,target:6}, account:{sold:12,target:15}, biz_loan:{sold:1,target:1} } },
    { id: 4, name: 'Martin Procházka',initials: 'MP', role: 'Junior finanční poradce',     crossSellRate: 1.8, clientsWithCrossSell: 2,  weeklyEarned: [7100, 9390, 0, 0],
      products: { hyp:{sold:0,target:0}, consumer:{sold:2,target:6}, cc:{sold:5,target:12}, pension:{sold:2,target:5}, stav:{sold:2,target:4}, invest:{sold:1,target:2}, life_ins:{sold:2,target:4}, prop_ins:{sold:2,target:5}, account:{sold:5,target:12}, biz_loan:{sold:0,target:0} } },
    { id: 5, name: 'Lucie Marková',   initials: 'LM', role: 'Pojišťovací specialista',     crossSellRate: 3.7, clientsWithCrossSell: 22, weeklyEarned: [26400, 34050, 0, 0],
      products: { hyp:{sold:1,target:1}, consumer:{sold:5,target:4}, cc:{sold:9,target:8}, pension:{sold:5,target:5}, stav:{sold:4,target:4}, invest:{sold:3,target:3}, life_ins:{sold:9,target:8}, prop_ins:{sold:11,target:10}, account:{sold:11,target:10}, biz_loan:{sold:0,target:0} } },
    { id: 6, name: 'Pavel Šimánek',   initials: 'PS', role: 'Finanční poradce',            crossSellRate: 3.1, clientsWithCrossSell: 14, weeklyEarned: [21400, 31900, 0, 0],
      products: { hyp:{sold:1,target:2}, consumer:{sold:6,target:6}, cc:{sold:11,target:12}, pension:{sold:5,target:5}, stav:{sold:3,target:4}, invest:{sold:3,target:3}, life_ins:{sold:4,target:4}, prop_ins:{sold:4,target:5}, account:{sold:12,target:12}, biz_loan:{sold:1,target:1} } },
  ],
};

app.get('/api/branch-reporter/demo', (req, res) => {
  res.json(BRANCH_DEMO);
});

// ─── Interní e-shop ────────────────────────────────────────────────────────────
const ESHOP_PRODUCTS = [
  { id: 1,  slug: 'penal-mod',          name: 'Penál Mod',                   description: 'Moderní penál s logem České spořitelny. Ideální pro stylové uložení psacích potřeb na každý den.',                                          price: 99,   category: 'kancelar',  categoryLabel: 'Kancelář',       stock: 91,  icon: '✏️',  gradient: '135deg, #667eea 0%, #764ba2 100%',      badge: null },
  { id: 2,  slug: 'penal-ruzovy',       name: 'Penál Růžový',                description: 'Růžový penál s logem ČS. Stylový a praktický doplněk pro každodenní použití.',                                                               price: 99,   category: 'kancelar',  categoryLabel: 'Kancelář',       stock: 119, icon: '✏️',  gradient: '135deg, #f093fb 0%, #f5576c 100%',      badge: 'Bestseller' },
  { id: 3,  slug: 'cardholder-cs',      name: 'Cardholder ČS',               description: 'Elegantní držák na karty s logem České spořitelny. Prémiový doplněk do každé kabelky nebo peněženky.',                                       price: 149,  category: 'doplnky',   categoryLabel: 'Doplňky',        stock: 116, icon: '💳',  gradient: '135deg, #2c3e50 0%, #4ca1af 100%',      badge: null },
  { id: 4,  slug: 'snurka-na-krk',      name: 'Šňůrka na krk',               description: 'Šňůrka na krk s logem ČS. Praktický doplněk pro nošení ID průkazů a klíčů.',                                                                 price: 79,   category: 'doplnky',   categoryLabel: 'Doplňky',        stock: 1000,icon: '🏷️', gradient: '135deg, #CC0000 0%, #8B0000 100%',      badge: 'Oblíbené' },
  { id: 5,  slug: 'jbl-horizon-2',      name: 'JBL Horizon 2',               description: 'FM Bluetooth hodiny s reproduktorem, USB nabíječkou a podsvícením. Probuďte se s oblíbenou hudbou.',                                          price: 2249, category: 'elektronika',categoryLabel: 'Elektronika',     stock: 16,  icon: '🔊',  gradient: '135deg, #4facfe 0%, #00f2fe 100%',      badge: null },
  { id: 6,  slug: 'jbl-clip-4',         name: 'JBL Clip 4',                  description: 'Přenosný Bluetooth reproduktor s integrovanou karabinou. IP67 voděodolný s 10hodinovou výdrží baterie.',                                      price: 1249, category: 'elektronika',categoryLabel: 'Elektronika',     stock: 5,   icon: '📢',  gradient: '135deg, #43e97b 0%, #38f9d7 100%',      badge: 'Poslední kusy' },
  { id: 7,  slug: 'bose-soundlink-flex',name: 'Bose SoundLink Flex',         description: 'Prémiový přenosný Bluetooth reproduktor s výjimečnou kvalitou zvuku. Odolný vůči vodě a prachu.',                                             price: 3749, category: 'elektronika',categoryLabel: 'Elektronika',     stock: 5,   icon: '🔊',  gradient: '135deg, #fa709a 0%, #fee140 100%',      badge: 'Prémiový' },
  { id: 8,  slug: 'bose-soundlink-micro',name: 'Bose SoundLink Micro',       description: 'Kompaktní Bluetooth reproduktor s neuvěřitelným zvukem v miniaturním provedení. Odolný vůči vodě.',                                           price: 2249, category: 'elektronika',categoryLabel: 'Elektronika',     stock: 10,  icon: '🔊',  gradient: '135deg, #a18cd1 0%, #fbc2eb 100%',      badge: null },
  { id: 9,  slug: 'jbl-live-460nc',     name: 'JBL Live 460NC',              description: 'Bezdrátová sluchátka s aktivním potlačením hluku a až 50 hodinami výdrže. Pohodlí na celý den.',                                              price: 2499, category: 'elektronika',categoryLabel: 'Elektronika',     stock: 7,   icon: '🎧',  gradient: '135deg, #30cfd0 0%, #330867 100%',      badge: null },
  { id: 10, slug: 'george-nabijacka',   name: 'George Bezdrát. nabíječka',   description: 'Bezdrátová nabíječka Qi s logem George – digitální banky ČS. Rychlé a pohodlné nabíjení.',                                                   price: 749,  category: 'elektronika',categoryLabel: 'Elektronika',     stock: 9,   icon: '⚡',  gradient: '135deg, #f7971e 0%, #ffd200 100%',      badge: 'George' },
  { id: 11, slug: 'powerbank-10000',    name: 'Powerbank 10 000 mAh',        description: 'Výkonná přenosná baterie 10 000 mAh s logem ČS. Nabití dvou zařízení najednou přes USB-A a USB-C.',                                           price: 999,  category: 'elektronika',categoryLabel: 'Elektronika',     stock: 5,   icon: '🔋',  gradient: '135deg, #96fbc4 0%, #f9f586 100%',      badge: 'Poslední kusy' },
  { id: 12, slug: 'ssd-1tb',            name: 'SSD 1 TB',                    description: 'Přenosný SSD disk 1 TB s logem ČS. Vysokorychlostní přenos dat, kompaktní design pro práci na cestách.',                                      price: 1999, category: 'elektronika',categoryLabel: 'Elektronika',     stock: 17,  icon: '💾',  gradient: '135deg, #ffecd2 0%, #fcb69f 100%',      badge: null },
  { id: 13, slug: 'powerbank-5000',     name: 'Powerbank 5 000 mAh',         description: 'Kompaktní přenosná baterie 5 000 mAh s logem ČS. Štíhlý design, vždy po ruce.',                                                              price: 649,  category: 'elektronika',categoryLabel: 'Elektronika',     stock: 3,   icon: '🔋',  gradient: '135deg, #a1c4fd 0%, #c2e9fb 100%',      badge: 'Poslední kusy' },
  { id: 14, slug: 'satinsky',           name: 'Satinský',                    description: 'Limitovaná edice produktu s motivy Ľuba Satinského ve spolupráci s Českou spořitelnou.',                                                      price: 379,  category: 'specialni', categoryLabel: 'Speciální edice', stock: 17,  icon: '🎭',  gradient: '135deg, #e0c3fc 0%, #8ec5fc 100%',      badge: 'Limitovaná edice' },
  { id: 15, slug: 'stebova',            name: 'Stebová',                     description: 'Speciální edice merche Stebová ve spolupráci s Českou spořitelnou. Unikátní kus do sbírky.',                                                  price: 379,  category: 'specialni', categoryLabel: 'Speciální edice', stock: 8,   icon: '🎨',  gradient: '135deg, #fdfbfb 0%, #c8d6df 100%',      badge: null },
  { id: 16, slug: 'element',            name: 'Element',                     description: 'Designový merch Element s logem České spořitelny. Praktický a stylový doplněk do každodenního života.',                                       price: 249,  category: 'doplnky',   categoryLabel: 'Doplňky',        stock: 6,   icon: '🎁',  gradient: '135deg, #d4fc79 0%, #96e6a1 100%',      badge: null },
  { id: 17, slug: 'miro-cobra',         name: 'Miro & Cobra',                description: 'Exkluzivní spolupráce Miro & Cobra s Českou spořitelnou. Limitovaný merch pro skutečné fanoušky.',                                           price: 499,  category: 'specialni', categoryLabel: 'Speciální edice', stock: 4,   icon: '🎵',  gradient: '135deg, #f6d365 0%, #fda085 100%',      badge: 'Spolupráce' },
  { id: 18, slug: 'ceska-republika',    name: 'Česká republika',             description: 'Vlastenecký merch Česká republika se symboly Čech a logem ČS. Projevte hrdost na svoji zemi.',                                               price: 329,  category: 'specialni', categoryLabel: 'Speciální edice', stock: 10,  icon: '🇨🇿', gradient: '135deg, #d7141a 0%, #FFFFFF 50%, #11457e 100%', badge: null },
];

const eshopOrders = [];

app.get('/api/eshop/products', (req, res) => {
  res.json(ESHOP_PRODUCTS);
});

app.post('/api/eshop/orders', (req, res) => {
  const { customer, items, note } = req.body;
  if (!customer || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid order data' });
  }
  const order = {
    id: `ORD-CS-${Date.now()}`,
    customer,
    items,
    note: note || '',
    total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  eshopOrders.push(order);
  fs.appendFileSync(
    path.join(LOG_DIR, 'app.log'),
    JSON.stringify({ time: new Date().toISOString(), event: 'eshop_order', order }) + '\n'
  );
  res.json({ success: true, orderId: order.id });
});

if (require.main === module) {
  app.listen(CONFIG.PORT, () => {
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        level: 'INFO',
        message: `Server running on port ${CONFIG.PORT}`,
      })
    );
  });
}

module.exports = { calcMonthlyPayment, classifyDTI };
