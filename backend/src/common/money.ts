/**
 * Revenue split for a paid order (proposal section 3.2).
 *
 * Net Revenue = gross - VAT - other mandatory statutory taxes.
 * Net Revenue is shared LEMAT TECHNOLOGY PLC 70% / Ethio Telecom 30% by default.
 * All values are integers in santim (1 ETB = 100 santim).
 */
export interface RevenueRules {
  pricesIncludeVat: boolean;
  vatRate: number;
  otherTaxRate: number;
  partnerShare: number;
}

export interface RevenueSplit {
  grossCents: number;
  vatCents: number;
  otherTaxCents: number;
  netCents: number;
  partnerShareCents: number;
  operatorShareCents: number;
}

export function splitRevenue(
  grossCents: number,
  rules: RevenueRules,
): RevenueSplit {
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new Error('grossCents must be a non-negative integer');
  }
  const vatCents = rules.pricesIncludeVat
    ? Math.round((grossCents * rules.vatRate) / (1 + rules.vatRate))
    : Math.round(grossCents * rules.vatRate);
  const taxable = rules.pricesIncludeVat ? grossCents - vatCents : grossCents;
  const otherTaxCents = Math.round(taxable * rules.otherTaxRate);
  const netCents = taxable - otherTaxCents;
  const partnerShareCents = Math.round(netCents * rules.partnerShare);
  return {
    grossCents,
    vatCents,
    otherTaxCents,
    netCents,
    partnerShareCents,
    // remainder goes to the operator so the two shares always add up to net exactly
    operatorShareCents: netCents - partnerShareCents,
  };
}

export const etb = (cents: number) => (cents / 100).toFixed(2);
