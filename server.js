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
