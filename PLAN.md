# Plan: SLSP Data Apps — Solution Finder (App 1)

## Context
Showcase of 3 Keboola JS Data Apps in one repo. App 1 "Solution Finder" — AI-powered (simulated) financial advisor. Collects client life story, incomes, liabilities, expenses → generates realistic debt-restructuring recommendations algorithmically (no real AI API calls, 2-3s fake delay). Demo character: Radek Špaček, IT team lead who accumulated debt through a funny chain of unlikely events.

Repo skeleton already exists: `server.js`, `package.json`, `keboola-config/`. Public dir and full implementation missing.

---

<!-- PHASE:1 -->
## Phase 1: Backend

### Branch
`phase-1-backend`

### Scope
Complete rewrite of `server.js` and update of `package.json`. The existing `server.js` is a rough skeleton — replace it entirely. No real AI API calls — all simulated.

### Files to Create/Modify

- `package.json` — add `"vitest": "^2.0.0"` to devDependencies, add `"test": "vitest run"` script. Keep express + cors. No @anthropic-ai/sdk.
- `server.js` — complete rewrite with:
  1. `CONFIG` object at top (all magic numbers, no hardcoding anywhere else)
  2. Structured JSON request logger middleware → appends to `logs/app.log`
  3. `POST /` → Keboola health check, returns "OK" (must stay FIRST before static serving)
  4. `app.use(express.static('public'))` for frontend
  5. `GET /api/solution-finder/demo` → returns full static Radek Špaček JSON
  6. `POST /api/solution-finder/ai-analyze` → fake AI analysis (see below)
  7. `calcMonthlyPayment(principal, annualRate, years)` pure function
  8. `classifyDTI(dti)` pure function → returns 'critical'|'high'|'medium'|'low'
  9. `generateAnalysis(data)` — pure sync function, builds recommendations from real math
  10. `simulateAI(data)` — async wrapper, adds 2000-3000ms delay then calls generateAnalysis
  11. At bottom: `if (require.main !== module) module.exports = { calcMonthlyPayment, classifyDTI };`

**CONFIG object:**
```js
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
  PORT: 3000,
};
```

**`generateAnalysis(data)` logic:**
Receives `{ life_story, incomes, assets, debts, expenses }`. Computes:
- `total_income` = sum of incomes[].monthly_net
- `total_debt_payments` = sum of debts[].monthly_payment
- `total_expenses` = sum of expenses[].monthly_amount
- `dti` = total_debt_payments / total_income
- `remaining` = total_income - total_debt_payments - total_expenses
- `severity` + `severity_label` from classifyDTI
- `health_score` = Math.round(Math.max(0, Math.min(100, 100 - dti * 130)))

Then builds `recommendations[]`:
1. **Mortgage**: if any debt with type === 'hypotéka' exists:
   - current: original rate and payment
   - proposed: recalculate with CONFIG.REFI_RATE_NEW, CONFIG.REFI_YEARS_MAX
   - monthly_saving = original_payment - new_payment
   - priority: dti > CONFIG.DTI_CRITICAL ? 'urgent' : 'high'

2. **Consolidation**: if non-mortgage debts count >= 2:
   - consolidation_balance = sum of non-mortgage debt balances
   - new_payment = calcMonthlyPayment(consolidation_balance, CONFIG.CONSOLIDATION_RATE, CONFIG.CONSOLIDATION_YEARS)
   - monthly_saving = sum_of_current_non_mortgage_payments - new_payment
   - proposed_change mentions CONFIG.CONSOLIDATION_DEFERRAL_MONTHS month deferral if dti > CONFIG.DTI_HIGH
   - priority: 'urgent' if dti > CONFIG.DTI_CRITICAL, else 'high'

3. **Asset sale**: for each asset where willing_to_sell === true and estimated_value > 0:
   - Find which debt(s) it could pay off (highest rate first)
   - monthly_saving = freed monthly payments
   - priority: 'medium'

4. **key_events**: split life_story on '.', filter sentences > 30 chars, take first 4

5. **projected_dti**: recalculate DTI after all recommendations applied

6. **narrative**: build from template using actual numbers, formal Czech (Vy/Vás)

**Returns JSON:**
```json
{
  "severity": "high",
  "severity_label": "Vysoká",
  "health_score": 23,
  "current_dti": 0.592,
  "projected_dti": 0.34,
  "key_events": ["..."],
  "recommendations": [{
    "id": "mortgage-refi",
    "priority": "urgent",
    "product": "Refinancování hypotéky",
    "current_terms": "5.9 % p.a., splátka 14 200 Kč/měs.",
    "proposed_change": "Snížení sazby na 4.3 %, prodloužení na 28 let",
    "monthly_saving": 3400,
    "one_time_note": "Poplatek za refinancování cca 5 000 Kč",
    "action_label": "Zahájit refinancování"
  }],
  "total_monthly_relief": 8600,
  "narrative": "Na základě Vaší situace..."
}
```

**Radek Špaček demo data (for GET /api/solution-finder/demo):**
```json
{
  "life_story": "Jmenuji se Radek Špaček, je mi 42 let a pracuji jako IT team lead. Vše začalo nevinnou sázkou s kolegou Honzou — vsadili jsme se o 5 000 Kč, jestli na bleším trhu koupím kajak. Kajak jsem koupil za 2 000 Kč, ale pak jsem investoval dalších 42 000 Kč do jeho renovace, protože to přece bude stát za to. Při prvním spuštění na Vltavě jsem převrátil turistický šlapadlový člun a musel zaplatit škody 29 000 Kč, plus mi utopil telefon. Mezitím můj bengálský kocour Kotelna prokousl napájecí kabely firemního MacBooku — IT oddělení mě donutilo zaplatit náhradu 38 000 Kč. Pak jsem viděl inzerát na luxusní rekonstrukci bytu se slevou 70 % — byl to podvod a přišel jsem o 82 000 Kč. Tentýž týden auto potřebovalo nové motory, protože jsem ho jezdil bez oleje — myslel jsem, že pipání je jen senzorová chyba. Oprava stála 57 000 Kč. Vše jsem řešil rychlými spotřebními půjčkami. Teď mi zbývá tak 6 200 Kč měsíčně.",
  "incomes": [
    {"type": "zaměstnání", "description": "IT team lead", "monthly_net": 52000},
    {"type": "pronájem", "description": "Podnájem pokoje", "monthly_net": 8500}
  ],
  "assets": [
    {"description": "Kajak (renovovaný)", "estimated_value": 8000, "willing_to_sell": true},
    {"description": "Osobní automobil", "estimated_value": 85000, "willing_to_sell": true}
  ],
  "debts": [
    {"type": "hypotéka", "bank": "Komerční banka", "balance": 2450000, "rate": 5.9, "monthly_payment": 14200},
    {"type": "spotřební úvěr", "bank": "Creditas", "balance": 145000, "rate": 12.4, "monthly_payment": 5200},
    {"type": "spotřební úvěr", "bank": "ČSOB", "balance": 85000, "rate": 14.9, "monthly_payment": 4100},
    {"type": "rychlá půjčka", "bank": "Air Bank", "balance": 178000, "rate": 18.9, "monthly_payment": 6800},
    {"type": "kreditní karta", "bank": "Česká spořitelna", "balance": 38000, "rate": 22.0, "monthly_payment": 3100},
    {"type": "kreditní karta", "bank": "Zonky", "balance": 26000, "rate": 24.9, "monthly_payment": 2400}
  ],
  "expenses": [
    {"category": "jídlo", "monthly_amount": 8000},
    {"category": "energie", "monthly_amount": 3500},
    {"category": "doprava", "monthly_amount": 2800},
    {"category": "jiné", "monthly_amount": 4200}
  ]
}
```

### Acceptance Criteria
- [ ] GET /api/solution-finder/demo returns Radek's JSON with all 6 debts, 2 incomes, 2 assets, 4 expenses
- [ ] POST /api/solution-finder/ai-analyze with Radek's data returns severity, health_score, at least 2 recommendations, total_monthly_relief > 0
- [ ] POST / returns status 200 with body "OK" (Keboola health check)
- [ ] Server starts without any environment variables
- [ ] calcMonthlyPayment and classifyDTI exported when required as module (not when run directly)
- [ ] All CONFIG values referenced by name, no raw numbers in logic code
- [ ] Fake AI delay between 2-3 seconds (verifiable by measuring response time)

### Tests Required
None in this phase — tests are Phase 4. Just verify endpoints manually with curl.
<!-- /PHASE:1 -->

---

<!-- PHASE:2 -->
## Phase 2: Landing Page

### Branch
`phase-2-landing-page`

### Scope
Create `public/index.html` — the landing page / rozcestník for all 3 apps.

### Files to Create/Modify
- `public/index.html` — full landing page, all CSS inline in `<style>` tag

**Design: SLSP red theme**
```css
:root {
  --primary: #D7001D;
  --primary-dark: #a80017;
  --bg: #ffffff;
  --text: #1a1a1a;
  --text-secondary: #666666;
  --border: #e5e5e5;
  --card-bg: #f8f8f8;
  --radius: 8px;
  --shadow: 0 2px 8px rgba(0,0,0,0.08);
  --font: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
}
```

**Layout:**
- `max-width: 1200px; margin: 0 auto; padding: 0 24px`
- Header: red background, white text, "SLSP Data Apps" h1 + "Ukázkové AI aplikace pro moderní bankovnictví | Powered by Keboola" subtitle
- Hero: centered h2 "Tři AI nástroje pro finanční poradce", short description paragraph
- App grid: CSS Grid `grid-template-columns: repeat(3, 1fr); gap: 24px`
- Footer: grey background, copyright

**3 App Cards:**

Card 1 — Solution Finder (ACTIVE):
- Blue accent bar at top (`#1B3A6B`)
- Inline SVG icon: shield/heart symbol
- Title: "Solution Finder"
- Description: "AI poradce analyzuje finanční situaci klienta a navrhuje konkrétní úpravy produktů pro dosažení solventnosti."
- Tags: badge "AI", badge "Finanční zdraví"
- CTA button (red, full width): `<a href="/solution-finder/">Otevřít aplikaci</a>`
- Hover: slight lift with box-shadow

Card 2 — Credit Scoring (COMING SOON):
- Grey accent bar
- Inline SVG icon: chart/score symbol
- Title: "Credit Scoring"
- Description: "Automatické vyhodnocení bonity klienta na základě transakční historie a behaviorálních dat."
- Badge "Již brzy" (grey, no link)
- CTA disabled (grey, cursor: not-allowed)

Card 3 — Investment Advisor (COMING SOON):
- Grey accent bar
- Inline SVG icon: growth arrow symbol
- Title: "Investment Advisor"
- Description: "Personalizovaná investiční strategie s ohledem na rizikový profil a finanční cíle klienta."
- Badge "Již brzy" (grey, no link)
- CTA disabled (grey, cursor: not-allowed)

All SVG icons must be inline (no img src, no external URLs).

### Acceptance Criteria
- [ ] Page loads at http://localhost:3000/ and shows 3 cards
- [ ] "Otevřít aplikaci" on Solution Finder card navigates to /solution-finder/
- [ ] Cards 2 and 3 have "Již brzy" badge and disabled (non-clickable) CTA
- [ ] Page is visually distinct from solution-finder (red primary vs blue)
- [ ] No external CSS or JS dependencies (all inline)
- [ ] All SVG icons rendered inline (no external image sources)

### Tests Required
None — visual verification only.
<!-- /PHASE:2 -->

---

<!-- PHASE:3 -->
## Phase 3: Solution Finder Wizard

### Branch
`phase-3-solution-finder`

### Scope
Create `public/solution-finder/index.html` — the full 4-step wizard. This is the largest and most important file. All CSS and JS must be inline in the single HTML file. Only allowed external dependency: Chart.js from CDN.

### Files to Create/Modify
- `public/solution-finder/index.html` — full wizard, all CSS + JS inline

**Design: Navy/blue theme**
```css
:root {
  --primary: #1B3A6B;
  --primary-light: #2a5298;
  --accent: #0066cc;
  --bg: #f0f4f8;
  --surface: #ffffff;
  --text: #1a2332;
  --text-secondary: #5a6a7a;
  --border: #d1dce8;
  --success: #0a7c42;
  --warning: #c45000;
  --danger: #c41230;
  --font: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
}
```

**Structure:**

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
```

Fixed header:
- Back link "← SLSP Data Apps" linking to "/"
- Title "Solution Finder"  
- Subtitle "AI poradce pro finanční zdraví klienta"

Progress bar (4 steps, fixed below header):
- Steps: "1. Životní příběh", "2. Příjmy & Majetek", "3. Závazky & Výdaje", "4. AI Analýza"
- Active step highlighted, completed steps with checkmark

**Step 1 — Životní příběh:**
- Label: "Životní situace klienta"
- `<textarea id="life-story-text" rows="8" placeholder="Popište klientovu situaci vlastními slovy — co se stalo, jak se dostal/a do finanční tísně...">`
- Info box (blue): "Tento text bude analyzován AI, která z něj extrahuje klíčové události."
- Prev (disabled on step 1) + Next buttons

**Step 2 — Příjmy & Majetek:**
- Section "Příjmy"
  - Table `#incomes-table` with headers: Typ | Popis | Čistý příjem/měs. (Kč) | 
  - Dynamic rows via addIncomeRow(data)
  - `<button onclick="addIncomeRow()">+ Přidat příjem</button>`
  - Income type select options: zaměstnání, podnikání, pronájem, ostatní
- Section "Majetek k prodeji"
  - Table `#assets-table` with headers: Popis | Odhadovaná hodnota (Kč) | Ochoten prodat
  - Dynamic rows via addAssetRow(data)
  - `<button onclick="addAssetRow()">+ Přidat majetek</button>`
- Summary bar: "Celkový měsíční příjem: X Kč"
- Prev + Next buttons

**Step 3 — Závazky & Výdaje:**
- Section "Závazky (úvěry)"
  - Table `#debts-table` with headers: Typ | Banka | Dlužná částka (Kč) | Úrok (% p.a.) | Splátka/měs. (Kč) |
  - Dynamic rows via addDebtRow(data)
  - Debt type select: hypotéka, spotřební úvěr, kreditní karta, rychlá půjčka, leasing, jiné
  - `<button onclick="addDebtRow()">+ Přidat závazek</button>`
- Section "Pravidelné výdaje"
  - Table `#expenses-table` with headers: Kategorie | Částka/měs. (Kč) |
  - Dynamic rows via addExpenseRow(data)
  - Category select: bydlení, jídlo, doprava, energie, jiné
  - `<button onclick="addExpenseRow()">+ Přidat výdaj</button>`
- Live DTI indicator: "Aktuální DTI: X.X %" — updates on every input event in debts/incomes tables. Color: green <30%, yellow 30-45%, orange 45-60%, red >60%
- Prev + Next buttons

**Step 4 — AI Analýza:**
- Large "Analyzovat situaci" button (primary color, full width)
- Loading state (hidden by default, shown during fetch):
  - Spinner animation (CSS-only, rotating circle)
  - Text "AI analyzuje Vaši situaci..." with animated dots
- Results section (hidden until analysis complete):
  - Top row: Severity badge (colored) + Health Score doughnut chart (Chart.js, canvas 200x200)
  - DTI comparison: horizontal bar chart (Chart.js) — "Před restrukturalizací" vs "Po restrukturalizaci"
  - Recommendation cards grid: for each recommendation render a card:
    - Priority badge top-right (urgent=red, high=orange, medium=blue)
    - Product name (bold, large)
    - Current terms (grey text)
    - Arrow "→" + proposed change (bold, primary color)
    - Monthly saving badge: "+ X Kč/měs." (green background)
    - One-time note (if present, italic, small)
    - CTA button: action_label text
  - Summary box: "Celková úspora: X Kč/měs." in large green text
  - Narrative: `<div class="narrative">` with whitespace-pre-wrap
  - Print button: `<button onclick="window.print()">Exportovat / Tisk</button>`
- Prev button

**State management:**
```js
const state = {
  currentStep: 1,
  lifeStory: '',
  incomes: [],
  assets: [],
  debts: [],
  expenses: [],
  analysisResult: null
};
```

**Key functions:**
- `goToStep(n)` — shows correct panel, updates progress bar
- `collectIncomes()`, `collectAssets()`, `collectDebts()`, `collectExpenses()` — read tables
- `updateDTIIndicator()` — called on input events in debts/incomes tables
- `runAnalysis()` — collects all state, POSTs to /api/solution-finder/ai-analyze, renders results
- `renderResults(data)` — builds all DOM for results section, creates Chart.js charts
- `addIncomeRow(data)`, `addAssetRow(data)`, `addDebtRow(data)`, `addExpenseRow(data)` — each creates a `<tr>` with correct inputs

**CZK formatting helper:**
```js
function formatCZK(n) {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(n);
}
```

**Demo button (floating):**
```html
<button id="demo-btn" onclick="loadDemo()">Demo: Radek Špaček</button>
```
CSS: `position: fixed; bottom: 24px; right: 24px; z-index: 100; background: #D7001D; color: white; border: none; padding: 12px 20px; border-radius: 24px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(215,0,29,0.4);`

`loadDemo()` function:
1. `fetch('/api/solution-finder/demo')` → gets Radek's data
2. Fills textarea with life_story
3. Clears and rebuilds each table with demo data using add*Row() functions
4. Calls `goToStep(4)` 
5. Shows a dismissable banner: "Demo data načtena — klikněte Analyzovat situaci"

### Acceptance Criteria
- [ ] All 4 steps render correctly, navigation works (Prev/Next)
- [ ] Demo button fills all forms and navigates to step 4
- [ ] "Analyzovat situaci" calls /api/solution-finder/ai-analyze and shows loading state
- [ ] Results render: severity badge, health score chart, DTI chart, recommendation cards, narrative
- [ ] Each recommendation card shows priority badge, monthly saving amount, CTA button
- [ ] Live DTI indicator updates as user types in debts/income tables
- [ ] No external CSS or font dependencies (Chart.js CDN is acceptable)
- [ ] Back link "← SLSP Data Apps" navigates to /
- [ ] Print button triggers browser print dialog

### Tests Required
None — visual/functional verification only.
<!-- /PHASE:3 -->

---

<!-- PHASE:4 -->
## Phase 4: Tests

### Branch
`phase-4-tests`

### Scope
Create vitest test suite for the pure calculation functions exported from server.js.

### Files to Create/Modify
- `tests/calculations.test.js` — CommonJS format vitest tests

**Test structure:**
```js
const { calcMonthlyPayment, classifyDTI } = require('../server');
const { describe, it, expect } = require('vitest');
```

**Required tests:**

1. `calcMonthlyPayment` suite:
   - Standard mortgage: `calcMonthlyPayment(2450000, 0.059, 22)` → result within 500 of 14200
   - Zero interest: `calcMonthlyPayment(12000, 0, 1)` → exactly 1000
   - Small loan: `calcMonthlyPayment(100000, 0.089, 7)` → result > 0 and < 2000

2. `classifyDTI` suite:
   - 0.65 → 'critical'
   - 0.50 → 'high'
   - 0.35 → 'medium'
   - 0.20 → 'low'
   - exactly 0.6 → 'critical'
   - exactly 0.3 → 'medium'

3. Radek's scenario:
   - Total income 52000+8500 = 60500
   - Total debt 14200+5200+4100+6800+3100+2400 = 35800
   - DTI = 35800/60500 ≈ 0.592
   - classifyDTI(35800/60500) → 'high'

4. Consolidation math:
   - Non-mortgage balance: 145000+85000+178000+38000+26000 = 472000
   - Old monthly: 5200+4100+6800+3100+2400 = 21600
   - New monthly: calcMonthlyPayment(472000, 0.089, 7) → should be less than 21600

### Acceptance Criteria
- [ ] `npm test` exits with code 0
- [ ] All 10+ test cases pass
- [ ] Tests import from '../server' (not a separate module)
- [ ] No trivial tests (assert(true) etc.)

### Tests Required
Run `npm test` — must pass.
<!-- /PHASE:4 -->
