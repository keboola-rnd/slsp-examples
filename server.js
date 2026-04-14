const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const LOG_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

app.use(cors());
app.use(express.json());

// Keboola health check
app.post("/", (req, res) => {
  res.status(200).send("OK");
});

// Structured request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const entry = JSON.stringify({
      time: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
    });
    fs.appendFileSync(path.join(LOG_DIR, "app.log"), entry + "\n");
  });
  next();
});

// Static files
app.use(express.static(path.join(__dirname, "public")));

// API: Solution Finder calculations
app.post("/api/solution-finder/analyze", (req, res) => {
  const { income, debts } = req.body;

  if (!income || !Array.isArray(debts)) {
    return res.status(400).json({ error: "Missing income or debts" });
  }

  const totalMonthlyPayment = debts.reduce((sum, d) => sum + d.monthlyPayment, 0);
  const totalBalance = debts.reduce((sum, d) => sum + d.balance, 0);
  const dti = totalMonthlyPayment / income;

  // Sort by interest rate descending (avalanche method)
  const sortedByRate = [...debts].sort((a, b) => b.rate - a.rate);

  // Phase 1: immediate relief — cancel subscriptions + sell assets
  const subscriptionSavings = req.body.subscriptionCosts || 0;
  const assetProceeds = req.body.assetProceeds || 0;

  let remainingDebts = debts.map((d) => ({ ...d }));
  let cashFromAssets = assetProceeds;

  // Pay off highest-rate debts first with asset proceeds
  for (const debt of sortedByRate) {
    if (cashFromAssets <= 0) break;
    const target = remainingDebts.find((d) => d.id === debt.id);
    if (cashFromAssets >= target.balance) {
      cashFromAssets -= target.balance;
      target.balance = 0;
      target.monthlyPayment = 0;
    } else {
      target.balance -= cashFromAssets;
      target.monthlyPayment = target.monthlyPayment * (target.balance / debt.balance);
      cashFromAssets = 0;
    }
  }

  const phase1Payment =
    remainingDebts.reduce((s, d) => s + d.monthlyPayment, 0) - subscriptionSavings;
  const phase1DTI = phase1Payment / income;

  // Phase 2: consolidation of non-mortgage debts + mortgage refinance
  const CONSOLIDATION_RATE = 0.089; // 8.9% p.a.
  const CONSOLIDATION_YEARS = 7;
  const REFI_RATE = 0.048; // 4.8% p.a.
  const REFI_YEARS = 30;

  const mortgages = remainingDebts.filter((d) => d.type === "mortgage" && d.balance > 0);
  const nonMortgages = remainingDebts.filter((d) => d.type !== "mortgage" && d.balance > 0);

  const consolidationBalance = nonMortgages.reduce((s, d) => s + d.balance, 0);
  const consolidationPayment =
    consolidationBalance > 0
      ? calcMonthlyPayment(consolidationBalance, CONSOLIDATION_RATE, CONSOLIDATION_YEARS)
      : 0;

  const refiPayments = mortgages.map((m) =>
    calcMonthlyPayment(m.balance, REFI_RATE, REFI_YEARS)
  );
  const totalRefiPayment = refiPayments.reduce((s, p) => s + p, 0);

  const phase2Payment = totalRefiPayment + consolidationPayment - subscriptionSavings;
  const phase2DTI = phase2Payment / income;

  // Phase 3: add insurance + savings
  const INSURANCE_MONTHLY = 1500;
  const SAVINGS_MONTHLY = 3000;
  const phase3Payment = phase2Payment + INSURANCE_MONTHLY + SAVINGS_MONTHLY;
  const phase3DTI = phase3Payment / income;

  // Commission calculation
  const consolidationCommission = consolidationBalance * 0.02;
  const mortgageCommission = mortgages.reduce((s, m) => s + m.balance * 0.015, 0);
  const insuranceCommission = INSURANCE_MONTHLY * 12 * 0.012;
  const totalCommission = consolidationCommission + mortgageCommission + insuranceCommission;

  res.json({
    overview: {
      income,
      totalMonthlyPayment,
      totalBalance,
      dti: Math.round(dti * 1000) / 10,
      riskLevel: dti > 0.6 ? "critical" : dti > 0.45 ? "high" : dti > 0.3 ? "medium" : "low",
    },
    phases: {
      phase1: {
        monthlyPayment: Math.round(phase1Payment),
        dti: Math.round(phase1DTI * 1000) / 10,
        actions: [
          subscriptionSavings > 0
            ? `Zrušení zbytných předplatných: úspora ${formatCZK(subscriptionSavings)}/měs.`
            : null,
          assetProceeds > 0
            ? `Prodej majetku: ${formatCZK(assetProceeds)} → umoření nejdražších úvěrů`
            : null,
        ].filter(Boolean),
        monthlyRelief: Math.round(totalMonthlyPayment - phase1Payment),
      },
      phase2: {
        monthlyPayment: Math.round(phase2Payment),
        dti: Math.round(phase2DTI * 1000) / 10,
        consolidationBalance: Math.round(consolidationBalance),
        consolidationPayment: Math.round(consolidationPayment),
        mortgageRefiPayment: Math.round(totalRefiPayment),
        actions: [
          consolidationBalance > 0
            ? `Konsolidace ${nonMortgages.length} závazků (${formatCZK(consolidationBalance)}) @ ${CONSOLIDATION_RATE * 100}% p.a. / ${CONSOLIDATION_YEARS} let`
            : null,
          mortgages.length > 0
            ? `Refinancování hypotéky @ ${REFI_RATE * 100}% / ${REFI_YEARS} let`
            : null,
        ].filter(Boolean),
        monthlyRelief: Math.round(phase1Payment - phase2Payment),
      },
      phase3: {
        monthlyPayment: Math.round(phase3Payment),
        dti: Math.round(phase3DTI * 1000) / 10,
        insuranceMonthly: INSURANCE_MONTHLY,
        savingsMonthly: SAVINGS_MONTHLY,
        actions: [
          `Pojistka pro případ výpadku příjmu: ${formatCZK(INSURANCE_MONTHLY)}/měs.`,
          `Investiční spořicí plán: ${formatCZK(SAVINGS_MONTHLY)}/měs.`,
        ],
      },
    },
    commissions: {
      consolidation: Math.round(consolidationCommission),
      mortgage: Math.round(mortgageCommission),
      insurance: Math.round(insuranceCommission),
      total: Math.round(totalCommission),
    },
  });
});

// API: manager team stats (static demo data)
app.get("/api/manager/team", (req, res) => {
  res.json({
    advisors: [
      {
        name: "Jana Procházková",
        mortgageVolume: 12500000,
        consolidationVolume: 3800000,
        insuranceVolume: 280000,
        commission: 12500000 * 0.015 + 3800000 * 0.02 + 280000 * 0.012,
        clients: 18,
        target: 15000000,
      },
      {
        name: "Tomáš Kovář",
        mortgageVolume: 8200000,
        consolidationVolume: 2100000,
        insuranceVolume: 190000,
        commission: 8200000 * 0.015 + 2100000 * 0.02 + 190000 * 0.012,
        clients: 12,
        target: 15000000,
      },
      {
        name: "Martin Beneš",
        mortgageVolume: 28300000,
        consolidationVolume: 9200000,
        insuranceVolume: 640000,
        commission:
          28300000 * (0.015 + 0.005) + 9200000 * (0.02 + 0.0075) + 640000 * 0.012,
        clients: 31,
        target: 15000000,
      },
      {
        name: "Eva Horáková",
        mortgageVolume: 3100000,
        consolidationVolume: 890000,
        insuranceVolume: 55000,
        commission: 3100000 * 0.015 + 890000 * 0.02 + 55000 * 0.012,
        clients: 6,
        target: 15000000,
      },
    ],
  });
});

function calcMonthlyPayment(principal, annualRate, years) {
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function formatCZK(amount) {
  return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 }).format(amount);
}

app.listen(PORT, () => {
  console.log(JSON.stringify({ time: new Date().toISOString(), level: "INFO", message: `Server running on port ${PORT}` }));
});
