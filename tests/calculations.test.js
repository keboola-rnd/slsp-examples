// describe, it, expect are injected as globals by vitest (globals: true in vitest.config.js)
const { calcMonthlyPayment, classifyDTI } = require('../server');

describe('calcMonthlyPayment', () => {
  // Standard mortgage: 2,450,000 Kc @ 5.9% p.a. / 22 years
  // Correct result is ~16591 Kc
  it('calculates standard mortgage payment correctly', () => {
    const payment = calcMonthlyPayment(2450000, 0.059, 22);
    expect(payment).toBeCloseTo(16591, -2); // within +/-100
  });

  // Zero interest rate: simple division
  it('handles zero interest rate', () => {
    const payment = calcMonthlyPayment(12000, 0, 1);
    expect(payment).toBe(1000); // 12000 / 12 months
  });

  // Refinancing scenario: new payment at 4.3% / 28 years on same balance
  it('calculates refinanced mortgage payment', () => {
    const payment = calcMonthlyPayment(2450000, 0.043, 28);
    expect(payment).toBeGreaterThan(12000);
    expect(payment).toBeLessThan(14000);
  });

  // Consolidation loan: 472000 Kc @ 8.9% / 7 years
  it('calculates consolidation loan payment', () => {
    const payment = calcMonthlyPayment(472000, 0.089, 7);
    expect(payment).toBeGreaterThan(0);
    expect(payment).toBeLessThan(8000); // must be less than old combined payments
  });

  // Small loan: 100000 @ 8.9% / 7 years -- payment > 0 and reasonable
  it('calculates small loan payment within expected range', () => {
    const payment = calcMonthlyPayment(100000, 0.089, 7);
    expect(payment).toBeGreaterThan(0);
    expect(payment).toBeLessThan(2000);
  });
});

describe('classifyDTI', () => {
  it('classifies 0.65 as critical', () => {
    expect(classifyDTI(0.65)).toBe('critical');
  });

  it('classifies 0.50 as high', () => {
    expect(classifyDTI(0.50)).toBe('high');
  });

  it('classifies 0.35 as medium', () => {
    expect(classifyDTI(0.35)).toBe('medium');
  });

  it('classifies 0.20 as low', () => {
    expect(classifyDTI(0.20)).toBe('low');
  });

  it('classifies exactly 0.6 as critical (boundary)', () => {
    expect(classifyDTI(0.6)).toBe('critical');
  });

  it('classifies exactly 0.45 as high (boundary)', () => {
    expect(classifyDTI(0.45)).toBe('high');
  });

  it('classifies exactly 0.3 as medium (boundary)', () => {
    expect(classifyDTI(0.3)).toBe('medium');
  });

  it('classifies 0 as low', () => {
    expect(classifyDTI(0)).toBe('low');
  });
});

describe('Radek Spacek scenario', () => {
  // Income: 52000 + 8500 = 60500
  // Debt payments: 16591 + 5200 + 4100 + 6800 + 3100 + 2400 = 38191
  // DTI = 38191 / 60500 = 0.631 -> critical
  it('Radek DTI is critical', () => {
    const totalIncome = 52000 + 8500;
    const totalDebt = 16591 + 5200 + 4100 + 6800 + 3100 + 2400;
    const dti = totalDebt / totalIncome;
    expect(dti).toBeGreaterThan(0.6);
    expect(classifyDTI(dti)).toBe('critical');
  });

  it('consolidation saves money compared to separate payments', () => {
    // Non-mortgage debts: 145000 + 85000 + 178000 + 38000 + 26000 = 472000
    // Old payments: 5200 + 4100 + 6800 + 3100 + 2400 = 21600
    const consolidationBalance = 145000 + 85000 + 178000 + 38000 + 26000;
    const newPayment = calcMonthlyPayment(consolidationBalance, 0.089, 7);
    const oldPayments = 5200 + 4100 + 6800 + 3100 + 2400;
    expect(newPayment).toBeLessThan(oldPayments); // consolidation must save money
  });

  it('mortgage refinancing saves money', () => {
    const currentPayment = calcMonthlyPayment(2450000, 0.059, 22);
    const refiPayment = calcMonthlyPayment(2450000, 0.043, 28);
    expect(refiPayment).toBeLessThan(currentPayment);
  });
});
