import type { AllModelResults, FactSale } from '../../types/sales';
import {
  aggregateCategories,
  aggregateProvinces,
  aggregateSalespeople,
  aggregateStores,
  computeCoreTotals,
  formatCAD,
  formatPct,
  getRowGross,
  getRowSales,
} from '../analytics/calculations';
import {
  trainAnomalyDetectionModel,
  trainBasketAffinityModel,
  trainDiscountImpactModel,
  trainSegmentationModel,
} from './models';

export interface VerifiedRetentionSignal {
  id: string;
  signalType:
    | 'declining_store'
    | 'rising_discount_dependence'
    | 'low_performing_salesperson'
    | 'price_deviation'
    | 'basket_cross_sell'
    | 'category_share_shift'
    | 'forecast_shortfall';
  targetType: 'Store' | 'Product' | 'Category' | 'Salesperson' | 'Channel' | 'Cross-Sell';
  targetName: string;
  sourceModel: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  revenueAtRiskCad: number;
  opportunityCad: number;
  metrics: Record<string, string | number>;
  evidenceSummary: string;
}

export function computeRetentionSignals(
  facts: FactSale[],
  trainedModels: AllModelResults,
  useRecomputed = true
): {
  signals: VerifiedRetentionSignal[];
  totalRevenueAtRisk: number;
  totalOpportunityValue: number;
  summaryStats: Record<string, string | number>;
} {
  const totals = computeCoreTotals(facts, useRecomputed);
  const stores = aggregateStores(facts, useRecomputed);
  const reps = aggregateSalespeople(facts, useRecomputed);
  const categories = aggregateCategories(facts, useRecomputed);
  const provinces = aggregateProvinces(facts, useRecomputed);

  const months = Array.from(new Set(facts.map((f) => f.yearMonth))).sort();
  const mid = Math.floor(months.length / 2);
  const firstHalfMonths = new Set(months.slice(0, mid));
  const secondHalfMonths = new Set(months.slice(mid));

  const signals: VerifiedRetentionSignal[] = [];

  // 1. Declining stores & rising discount dependence
  for (const st of stores) {
    const stRows = facts.filter((f) => f.store === st.store);
    const firstRows = stRows.filter((f) => firstHalfMonths.has(f.yearMonth));
    const secondRows = stRows.filter((f) => secondHalfMonths.has(f.yearMonth));

    const firstGross = firstRows.reduce((a, r) => a + getRowGross(r, useRecomputed), 0) || 1;
    const secondGross = secondRows.reduce((a, r) => a + getRowGross(r, useRecomputed), 0) || 1;
    const firstDiscPct = firstRows.reduce((a, r) => a + r.discountAmount, 0) / firstGross;
    const secondDiscPct = secondRows.reduce((a, r) => a + r.discountAmount, 0) / secondGross;
    const discDeltaPts = (secondDiscPct - firstDiscPct) * 100;

    // Provincial share shift
    const provFirst =
      facts
        .filter((f) => f.province === st.province && firstHalfMonths.has(f.yearMonth))
        .reduce((a, r) => a + getRowSales(r, useRecomputed), 0) || 1;
    const provSecond =
      facts
        .filter((f) => f.province === st.province && secondHalfMonths.has(f.yearMonth))
        .reduce((a, r) => a + getRowSales(r, useRecomputed), 0) || 1;
    const stFirstSales = firstRows.reduce((a, r) => a + getRowSales(r, useRecomputed), 0);
    const stSecondSales = secondRows.reduce((a, r) => a + getRowSales(r, useRecomputed), 0);
    const shareDeltaPts = (stSecondSales / provSecond - stFirstSales / provFirst) * 100;

    if ((st.growthPct !== null && st.growthPct < -0.02) || discDeltaPts > 1.8) {
      const lostSales = Math.max(0, stFirstSales - stSecondSales);
      const excessDiscCost = Math.max(0, (secondDiscPct - totals.discountPct) * secondGross);
      const atRisk = Math.round(lostSales + excessDiscCost);
      const opp = Math.round(atRisk * 0.65 + stSecondSales * 0.06);

      signals.push({
        id: `sig-store-${st.store}`,
        signalType: st.growthPct !== null && st.growthPct < -0.02 ? 'declining_store' : 'rising_discount_dependence',
        targetType: 'Store',
        targetName: `${st.store} (${st.province})`,
        sourceModel: 'Store Period-over-Period & Discount Reliance Analysis',
        severity: (st.growthPct ?? 0) < -0.08 || discDeltaPts > 3 ? 'Critical' : 'High',
        revenueAtRiskCad: atRisk,
        opportunityCad: opp,
        metrics: {
          totalSalesCad: st.sales,
          growthPct: st.growthPct !== null ? `${(st.growthPct * 100).toFixed(1)}%` : 'N/A',
          discountRatePrior: formatPct(firstDiscPct),
          discountRateRecent: formatPct(secondDiscPct),
          discountDeltaPts: `${discDeltaPts >= 0 ? '+' : ''}${discDeltaPts.toFixed(1)} pts`,
          provinceShareDeltaPts: `${shareDeltaPts >= 0 ? '+' : ''}${shareDeltaPts.toFixed(1)} pts`,
          aovCad: Math.round(st.aov),
        },
        evidenceSummary: `Sales shifted ${st.growthPct !== null ? `${(st.growthPct * 100).toFixed(1)}%` : 'N/A'} half-over-half; discount rate moved from ${formatPct(firstDiscPct)} to ${formatPct(secondDiscPct)} (${discDeltaPts >= 0 ? '+' : ''}${discDeltaPts.toFixed(1)} pts); provincial share changed ${shareDeltaPts >= 0 ? '+' : ''}${shareDeltaPts.toFixed(1)} pts.`,
      });
    }
  }

  // 2. Bottom-quartile salespeople (coaching & discount discipline)
  const bottomReps = reps.filter((r) => r.quartile === 'Q4 (Bottom)' || r.discountPct > totals.discountPct * 1.25);
  const medianRepSales = reps.length > 0 ? reps[Math.floor(reps.length / 2)].sales : 0;
  for (const rep of bottomReps.slice(0, 3)) {
    const gapToMedian = Math.max(0, medianRepSales - rep.sales);
    const excessDisc = Math.max(0, (rep.discountPct - totals.discountPct) * rep.sales);
    signals.push({
      id: `sig-rep-${rep.salesperson}`,
      signalType: 'low_performing_salesperson',
      targetType: 'Salesperson',
      targetName: `${rep.salesperson} (${rep.primaryStore})`,
      sourceModel: trainedModels.repSegmentation?.sufficientData
        ? 'K-Means Salesperson Segmentation + Quartile Audit'
        : 'Salesperson Quartile & Discount Benchmark',
      severity: rep.quartile === 'Q4 (Bottom)' && rep.discountPct > totals.discountPct * 1.2 ? 'High' : 'Medium',
      revenueAtRiskCad: Math.round(excessDisc + gapToMedian * 0.25),
      opportunityCad: Math.round(gapToMedian * 0.45 + excessDisc * 0.6),
      metrics: {
        salesCad: rep.sales,
        peerMedianSalesCad: Math.round(medianRepSales),
        orders: rep.orders,
        aovCad: Math.round(rep.aov),
        discountPct: formatPct(rep.discountPct),
        companyAvgDiscountPct: formatPct(totals.discountPct),
        quartile: rep.quartile,
      },
      evidenceSummary: `Ranked #${rep.rank}/${reps.length} (${rep.quartile}) with ${formatCAD(rep.sales)} sales vs peer median ${formatCAD(medianRepSales)}, AOV ${formatCAD(rep.aov)}, and discount rate ${formatPct(rep.discountPct)} vs company avg ${formatPct(totals.discountPct)}.`,
    });
  }

  // 3. Basket cross-sell opportunities
  const basketModel = trainedModels.basketAffinity ?? trainBasketAffinityModel(facts);
  if (basketModel.sufficientData && basketModel.rules.length > 0) {
    const topRules = basketModel.rules.slice(0, 2);
    for (const rule of topRules) {
      const antOrders = new Set(facts.filter((f) => f.product === rule.antecedent).map((f) => f.orderId)).size;
      const consAvgPrice =
        facts.filter((f) => f.product === rule.consequent).reduce((a, r) => a + r.unitPrice, 0) /
        Math.max(1, facts.filter((f) => f.product === rule.consequent).length);
      const unattachedOrders = Math.max(0, Math.round(antOrders * (1 - rule.confidence / 100)));
      const estOpp = Math.round(unattachedOrders * 0.15 * consAvgPrice);

      signals.push({
        id: `sig-basket-${rule.id}`,
        signalType: 'basket_cross_sell',
        targetType: 'Cross-Sell',
        targetName: `${rule.antecedent} → ${rule.consequent}`,
        sourceModel: 'Apriori Basket Affinity Model',
        severity: rule.lift >= 2 ? 'High' : 'Medium',
        revenueAtRiskCad: 0,
        opportunityCad: estOpp,
        metrics: {
          lift: `${rule.lift}x`,
          confidencePct: `${rule.confidence}%`,
          supportPct: `${rule.support}%`,
          coOccurrences: rule.coOccurrences,
          unattachedAntecedentOrders: unattachedOrders,
          consequentAvgPriceCad: Math.round(consAvgPrice),
        },
        evidenceSummary: `Bought together in ${rule.coOccurrences} orders (${rule.confidence}% confidence, ${rule.lift}x lift). ${unattachedOrders} orders bought ${rule.antecedent} without ${rule.consequent}; attaching 15% yields ~${formatCAD(estOpp)}.`,
      });
    }
  }

  // 4. Discount Elasticity & Over-Discounting Signal
  const discModel = trainedModels.discountImpact ?? trainDiscountImpactModel(facts, useRecomputed);
  if (discModel.sufficientData) {
    const heavyDiscRows = facts.filter((f) => f.discountRate > 0.15);
    const heavyDiscCost = heavyDiscRows.reduce((a, r) => a + r.discountAmount, 0);
    if (heavyDiscCost > 0) {
      signals.push({
        id: 'sig-discount-band',
        signalType: 'rising_discount_dependence',
        targetType: 'Category',
        targetName: `Deep Discounts (>15% Band across ${categories[0]?.category ?? 'Catalog'})`,
        sourceModel: 'Log-Log Discount Elasticity Model',
        severity: 'High',
        revenueAtRiskCad: Math.round(heavyDiscCost * 0.35),
        opportunityCad: Math.round(heavyDiscCost * 0.25),
        metrics: {
          optimalDiscountBand: discModel.optimalDiscountBand,
          quantityElasticity: discModel.quantityElasticity,
          r2: discModel.r2,
          heavyDiscountTransactions: heavyDiscRows.length,
          heavyDiscountCostCad: Math.round(heavyDiscCost),
        },
        evidenceSummary: `${heavyDiscRows.length} transactions received >15% discounts costing ${formatCAD(heavyDiscCost)} in concessions; highest realization occurs in the ${discModel.optimalDiscountBand} band (qty elasticity ${discModel.quantityElasticity}, R² ${discModel.r2}).`,
      });
    }
  }

  // 5. Price Anomalies & Data Integrity Signal
  const anomModel = trainedModels.anomalies ?? trainAnomalyDetectionModel(facts, useRecomputed);
  const priceAnoms = facts.filter((f) => f.isPriceAnomaly);
  if (priceAnoms.length > 0) {
    const impact = priceAnoms.reduce((a, r) => a + Math.abs(r.salesAmount * (r.priceDeviationPct / 100)), 0);
    signals.push({
      id: 'sig-price-anom',
      signalType: 'price_deviation',
      targetType: 'Product',
      targetName: `${priceAnoms[0].product} & ${Math.max(0, new Set(priceAnoms.map((p) => p.product)).size - 1)} others`,
      sourceModel: 'Anomaly Detection + Reference Price Validation',
      severity: priceAnoms.length > 15 ? 'High' : 'Medium',
      revenueAtRiskCad: Math.round(impact * 0.5),
      opportunityCad: Math.round(impact * 0.4),
      metrics: {
        flaggedTransactions: priceAnoms.length,
        totalAnomaliesDetected: anomModel.flaggedCount,
        estimatedVarianceCad: Math.round(impact),
      },
      evidenceSummary: `${priceAnoms.length} transactions deviated by more than ±25% from Dim_Product reference pricing (estimated price variance ${formatCAD(impact)}).`,
    });
  }

  // 6. Store Segmentation At-Risk check
  const storeSeg = trainedModels.storeSegmentation ?? trainSegmentationModel(facts, 'store', useRecomputed);
  if (storeSeg.sufficientData) {
    const atRiskStores = storeSeg.entities.filter((e) => e.tier === 'At-Risk');
    for (const s of atRiskStores.slice(0, 1)) {
      if (!signals.some((sig) => sig.targetName.includes(s.name))) {
        signals.push({
          id: `sig-seg-${s.name}`,
          signalType: 'declining_store',
          targetType: 'Store',
          targetName: s.name,
          sourceModel: 'K-Means Store Performance Segmentation',
          severity: 'High',
          revenueAtRiskCad: Math.round(s.sales * 0.12),
          opportunityCad: Math.round(s.sales * 0.1),
          metrics: {
            tier: s.tier,
            salesCad: s.sales,
            growthPct: `${s.growthPct}%`,
            discountPct: `${s.discountRate}%`,
            aovCad: s.aov,
          },
          evidenceSummary: `Clustered into the At-Risk tier (silhouette ${storeSeg.silhouetteScore}) with ${s.growthPct}% growth, ${s.discountRate}% discount rate, and CA$${s.aov} AOV.`,
        });
      }
    }
  }

  const totalRevenueAtRisk = signals.reduce((acc, s) => acc + s.revenueAtRiskCad, 0);
  const totalOpportunityValue = signals.reduce((acc, s) => acc + s.opportunityCad, 0);

  return {
    signals,
    totalRevenueAtRisk,
    totalOpportunityValue,
    summaryStats: {
      totalSalesCad: Math.round(totals.sales),
      totalOrders: totals.orders,
      aovCad: Math.round(totals.aov),
      effectiveDiscountPct: formatPct(totals.discountPct),
      storeCount: stores.length,
      provinceCount: provinces.length,
      salespersonCount: reps.length,
    },
  };
}
