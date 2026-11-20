import type {
  AllModelResults,
  ChatMiniViz,
  FactSale,
  GlobalFilters,
} from '../../types/sales';
import {
  aggregateMonthlyTrend,
  computeCoreTotals,
  formatCAD,
  formatPct,
  getDataDateBounds,
  getRowSales,
  safeGrowthPct,
} from '../analytics/calculations';
import {
  trainAnomalyDetectionModel,
  trainSalesForecastModel,
  trainSegmentationModel,
} from '../ml/models';

export interface ToolExecutionOutcome {
  toolName: string;
  result: Record<string, unknown>;
  viz?: ChatMiniViz;
  filtersApplied: string;
}

function filterSubset(
  facts: FactSale[],
  args: {
    dateFrom?: string;
    dateTo?: string;
    stores?: string[];
    provinces?: string[];
    categories?: string[];
    products?: string[];
    salespeople?: string[];
    channels?: string[];
    paymentMethods?: string[];
  }
): { rows: FactSale[]; desc: string } {
  const parts: string[] = [];
  let rows = facts;

  if (args.dateFrom) {
    rows = rows.filter((r) => r.date >= args.dateFrom!);
    parts.push(`From ${args.dateFrom}`);
  }
  if (args.dateTo) {
    rows = rows.filter((r) => r.date <= args.dateTo!);
    parts.push(`To ${args.dateTo}`);
  }
  const matchList = (list: string[] | undefined, getter: (r: FactSale) => string, label: string) => {
    if (!list || list.length === 0) return;
    const lowered = list.map((x) => x.toLowerCase());
    rows = rows.filter((r) => lowered.some((l) => getter(r).toLowerCase().includes(l)));
    parts.push(`${label}: ${list.join(', ')}`);
  };

  matchList(args.stores, (r) => r.store, 'Stores');
  matchList(args.provinces, (r) => r.province, 'Provinces');
  matchList(args.categories, (r) => r.category, 'Categories');
  matchList(args.products, (r) => r.product, 'Products');
  matchList(args.salespeople, (r) => r.salesperson, 'Salespeople');
  matchList(args.channels, (r) => r.salesChannel, 'Channels');
  matchList(args.paymentMethods, (r) => r.paymentMethod, 'Payments');

  return { rows, desc: parts.length > 0 ? parts.join(' · ') : 'Active dashboard filter scope' };
}

function groupGetter(dim: string): (r: FactSale) => string {
  switch (dim) {
    case 'month':
      return (r) => r.yearMonth;
    case 'quarter':
      return (r) => `${r.year}-Q${r.quarter}`;
    case 'year':
      return (r) => String(r.year);
    case 'store':
      return (r) => r.store;
    case 'province':
      return (r) => r.province;
    case 'category':
      return (r) => r.category;
    case 'product':
      return (r) => r.product;
    case 'salesperson':
      return (r) => r.salesperson;
    case 'channel':
      return (r) => r.salesChannel;
    case 'paymentMethod':
      return (r) => r.paymentMethod;
    case 'dayOfWeek':
      return (r) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${r.date}T00:00:00Z`).getUTCDay()];
    default:
      return () => 'All';
  }
}

export async function executeLocalAnalystTool(
  name: string,
  args: Record<string, unknown>,
  facts: FactSale[],
  trainedModels: AllModelResults,
  useRecomputed = true
): Promise<ToolExecutionOutcome> {
  if (name === 'query_sales') {
    const { rows, desc } = filterSubset(facts, args as Parameters<typeof filterSubset>[1]);
    const groupBy = String(args.groupBy || 'none');
    const metric = String(args.metric || 'salesAmount');
    const sortOrder = String(args.sortOrder || 'desc');
    const limit = Math.min(25, Math.max(1, Number(args.limit) || 12));

    if (groupBy === 'none') {
      const totals = computeCoreTotals(rows, useRecomputed);
      return {
        toolName: name,
        filtersApplied: desc,
        result: {
          rowsMatched: rows.length,
          salesAmountCad: Number(totals.sales.toFixed(2)),
          grossSalesCad: Number(totals.grossSales.toFixed(2)),
          discountAmountCad: Number(totals.discountAmount.toFixed(2)),
          discountRatePct: Number((totals.discountPct * 100).toFixed(2)),
          quantity: totals.quantity,
          orders: totals.orders,
          aovCad: Number(totals.aov.toFixed(2)),
        },
      };
    }

    const getter = groupGetter(groupBy);
    const buckets = new Map<string, FactSale[]>();
    for (const r of rows) {
      const k = getter(r);
      const arr = buckets.get(k) ?? [];
      arr.push(r);
      buckets.set(k, arr);
    }

    const summaryRows = Array.from(buckets.entries()).map(([label, grpRows]) => {
      const t = computeCoreTotals(grpRows, useRecomputed);
      return {
        label,
        salesAmount: Number(t.sales.toFixed(2)),
        grossSales: Number(t.grossSales.toFixed(2)),
        discountAmount: Number(t.discountAmount.toFixed(2)),
        discountRate: Number((t.discountPct * 100).toFixed(2)),
        quantity: t.quantity,
        orders: t.orders,
        aov: Number(t.aov.toFixed(2)),
      };
    });

    const isTimeDim = ['month', 'quarter', 'year'].includes(groupBy);
    if (isTimeDim) {
      summaryRows.sort((a, b) => a.label.localeCompare(b.label));
    } else {
      summaryRows.sort((a, b) => {
        const av = Number((a as Record<string, unknown>)[metric] ?? a.salesAmount);
        const bv = Number((b as Record<string, unknown>)[metric] ?? b.salesAmount);
        return sortOrder === 'asc' ? av - bv : bv - av;
      });
    }
    const sliced = summaryRows.slice(0, limit);

    return {
      toolName: name,
      filtersApplied: desc,
      result: { groupBy, metric, count: sliced.length, rows: sliced },
      viz: {
        type: isTimeDim ? 'line' : 'bar',
        title: `${metric === 'aov' ? 'AOV (CAD)' : metric === 'quantity' ? 'Quantity' : 'Sales (CAD)'} by ${groupBy}`,
        columns: ['label', metric === 'aov' ? 'aov' : metric === 'quantity' ? 'quantity' : 'salesAmount'],
        rows: sliced.map((r) => ({
          label: r.label,
          value: Number((r as Record<string, unknown>)[metric] ?? r.salesAmount),
          salesAmount: r.salesAmount,
          orders: r.orders,
          aov: r.aov,
        })),
        xKey: 'label',
        yKey: 'value',
      },
    };
  }

  if (name === 'compare_periods') {
    const pAFrom = String(args.periodAFrom || '');
    const pATo = String(args.periodATo || '');
    const pBFrom = String(args.periodBFrom || '');
    const pBTo = String(args.periodBTo || '');
    const groupBy = String(args.groupBy || 'none');

    const baseFilter = {
      stores: args.stores as string[] | undefined,
      provinces: args.provinces as string[] | undefined,
      categories: args.categories as string[] | undefined,
    };
    const setA = filterSubset(facts, { ...baseFilter, dateFrom: pAFrom, dateTo: pATo });
    const setB = filterSubset(facts, { ...baseFilter, dateFrom: pBFrom, dateTo: pBTo });

    if (groupBy === 'none') {
      const totA = computeCoreTotals(setA.rows, useRecomputed);
      const totB = computeCoreTotals(setB.rows, useRecomputed);
      const growth = safeGrowthPct(totA.sales, totB.sales);
      return {
        toolName: name,
        filtersApplied: `Period A (${pAFrom}..${pATo}) vs Period B (${pBFrom}..${pBTo})`,
        result: {
          periodA: { sales: Number(totA.sales.toFixed(2)), orders: totA.orders, aov: Number(totA.aov.toFixed(2)), quantity: totA.quantity },
          periodB: { sales: Number(totB.sales.toFixed(2)), orders: totB.orders, aov: Number(totB.aov.toFixed(2)), quantity: totB.quantity },
          salesDeltaCad: Number((totA.sales - totB.sales).toFixed(2)),
          salesGrowthPct: growth !== null ? Number((growth * 100).toFixed(2)) : null,
        },
        viz: {
          type: 'bar',
          title: `Period Comparison (${pAFrom}..${pATo} vs ${pBFrom}..${pBTo})`,
          columns: ['label', 'value'],
          rows: [
            { label: `Period B (${pBFrom})`, value: Number(totB.sales.toFixed(2)) },
            { label: `Period A (${pAFrom})`, value: Number(totA.sales.toFixed(2)) },
          ],
          xKey: 'label',
          yKey: 'value',
        },
      };
    }

    const getter = groupGetter(groupBy);
    const keys = new Set<string>([...setA.rows.map(getter), ...setB.rows.map(getter)]);
    const rowsOut = Array.from(keys).map((k) => {
      const aSales = setA.rows.filter((r) => getter(r) === k).reduce((acc, r) => acc + getRowSales(r, useRecomputed), 0);
      const bSales = setB.rows.filter((r) => getter(r) === k).reduce((acc, r) => acc + getRowSales(r, useRecomputed), 0);
      const g = safeGrowthPct(aSales, bSales);
      return {
        label: k,
        periodASales: Number(aSales.toFixed(2)),
        periodBSales: Number(bSales.toFixed(2)),
        deltaCad: Number((aSales - bSales).toFixed(2)),
        growthPct: g !== null ? Number((g * 100).toFixed(1)) : 0,
      };
    });
    rowsOut.sort((a, b) => Math.abs(b.deltaCad) - Math.abs(a.deltaCad));

    return {
      toolName: name,
      filtersApplied: `${groupBy} comparison: ${pAFrom}..${pATo} vs ${pBFrom}..${pBTo}`,
      result: { groupBy, comparison: rowsOut.slice(0, 15) },
      viz: {
        type: 'table',
        title: `Period Comparison by ${groupBy}`,
        columns: ['label', 'periodASales', 'periodBSales', 'deltaCad', 'growthPct'],
        rows: rowsOut.slice(0, 10),
      },
    };
  }

  if (name === 'top_n') {
    const entity = String(args.entity || 'store');
    const metric = String(args.metric || 'salesAmount');
    const direction = String(args.direction || 'top');
    const n = Math.min(20, Math.max(1, Number(args.n) || 5));
    const { rows, desc } = filterSubset(facts, args as Parameters<typeof filterSubset>[1]);

    const getter = groupGetter(entity);
    const months = Array.from(new Set(rows.map((r) => r.yearMonth))).sort();
    const mid = Math.floor(months.length / 2);
    const firstHalf = new Set(months.slice(0, mid));
    const secondHalf = new Set(months.slice(mid));

    const buckets = new Map<string, FactSale[]>();
    for (const r of rows) {
      const k = getter(r);
      const arr = buckets.get(k) ?? [];
      arr.push(r);
      buckets.set(k, arr);
    }

    const items = Array.from(buckets.entries()).map(([label, grp]) => {
      const t = computeCoreTotals(grp, useRecomputed);
      const s1 = grp.filter((r) => firstHalf.has(r.yearMonth)).reduce((a, r) => a + getRowSales(r, useRecomputed), 0);
      const s2 = grp.filter((r) => secondHalf.has(r.yearMonth)).reduce((a, r) => a + getRowSales(r, useRecomputed), 0);
      const g = safeGrowthPct(s2, s1);
      return {
        label,
        salesAmount: Number(t.sales.toFixed(2)),
        quantity: t.quantity,
        orders: t.orders,
        aov: Number(t.aov.toFixed(2)),
        discountRate: Number((t.discountPct * 100).toFixed(2)),
        growthPct: g !== null ? Number((g * 100).toFixed(1)) : 0,
      };
    });

    items.sort((a, b) => {
      const av = Number((a as Record<string, unknown>)[metric] ?? a.salesAmount);
      const bv = Number((b as Record<string, unknown>)[metric] ?? b.salesAmount);
      return direction === 'bottom' ? av - bv : bv - av;
    });

    const sliced = items.slice(0, n);
    return {
      toolName: name,
      filtersApplied: desc,
      result: { entity, metric, direction, items: sliced },
      viz: {
        type: 'bar',
        title: `${direction === 'bottom' ? 'Bottom' : 'Top'} ${n} ${entity}s by ${metric}`,
        columns: ['label', metric],
        rows: sliced.map((r) => ({
          label: r.label,
          value: Number((r as Record<string, unknown>)[metric] ?? r.salesAmount),
        })),
        xKey: 'label',
        yKey: 'value',
      },
    };
  }

  if (name === 'get_forecast') {
    const horizon = ([3, 6, 12].includes(Number(args.horizonMonths)) ? Number(args.horizonMonths) : 3) as 3 | 6 | 12;
    let scoped = facts;
    let scopeLabel = 'All Stores & Categories';
    if (args.province) {
      const p = String(args.province).toLowerCase();
      scoped = scoped.filter((f) => f.province.toLowerCase().includes(p));
      scopeLabel = `Province: ${args.province}`;
    }
    const scopeType = args.store ? 'store' : args.category ? 'category' : 'overall';
    const scopeValue = args.store ? String(args.store) : args.category ? String(args.category) : undefined;

    const fc = await trainSalesForecastModel({
      facts: scoped,
      horizonMonths: horizon,
      scopeType,
      scopeValue,
      useLstm: false,
      useRecomputed,
    });

    const futurePoints = fc.points.filter((p) => p.isForecast);
    return {
      toolName: name,
      filtersApplied: `${scopeValue ? `${scopeType}: ${scopeValue}` : scopeLabel} · Horizon ${horizon}M`,
      result: {
        sufficientData: fc.sufficientData,
        insufficientReason: fc.insufficientReason,
        method: fc.method,
        beatsNaiveBaseline: fc.naiveBaseline.beatsBaseline,
        metrics: fc.metrics,
        naiveBaseline: fc.naiveBaseline,
        projectedMonths: futurePoints.map((p) => ({
          yearMonth: p.yearMonth,
          predictedSalesCad: p.predicted,
          lower80: p.lower80,
          upper80: p.upper80,
          predictedQuantity: p.quantityPredicted,
        })),
        totalProjectedSalesCad: Number(
          futurePoints.reduce((a, p) => a + (p.predicted ?? 0), 0).toFixed(2)
        ),
      },
      viz: fc.sufficientData
        ? {
            type: 'line',
            title: `${horizon}-Month Forecast (${scopeValue || scopeLabel})`,
            columns: ['label', 'value'],
            rows: futurePoints.map((p) => ({ label: p.yearMonth, value: p.predicted ?? 0 })),
            xKey: 'label',
            yKey: 'value',
          }
        : undefined,
    };
  }

  if (name === 'get_anomalies') {
    const anom = trainedModels.anomalies ?? trainAnomalyDetectionModel(facts, useRecomputed);
    const typeFilter = String(args.type || 'all');
    const limit = Math.min(15, Math.max(1, Number(args.limit) || 8));
    const filtered =
      typeFilter === 'all' ? anom.anomalies : anom.anomalies.filter((a) => a.type === typeFilter);
    const top = filtered.slice(0, limit);
    return {
      toolName: name,
      filtersApplied: `Anomaly type: ${typeFilter}`,
      result: {
        totalFlagged: anom.flaggedCount,
        precisionProxyPct: anom.precisionProxy,
        anomalies: top,
      },
      viz: {
        type: 'table',
        title: `Top Detected Anomalies (${typeFilter})`,
        columns: ['date', 'entity', 'metric', 'observed', 'expected', 'severity'],
        rows: top.map((a) => ({
          date: a.date,
          entity: a.entity,
          metric: a.metric,
          observed: a.observed,
          expected: a.expected,
          severity: a.severity,
        })),
      },
    };
  }

  if (name === 'get_segment_profile') {
    const entityType = args.entityType === 'salesperson' ? 'salesperson' : 'store';
    const seg =
      (entityType === 'store' ? trainedModels.storeSegmentation : trainedModels.repSegmentation) ??
      trainSegmentationModel(facts, entityType, useRecomputed);
    const tierFilter = args.tier ? String(args.tier) : '';
    const entities = tierFilter
      ? seg.entities.filter((e) => e.tier.toLowerCase() === tierFilter.toLowerCase())
      : seg.entities;
    return {
      toolName: name,
      filtersApplied: `${entityType} segmentation${tierFilter ? ` · Tier: ${tierFilter}` : ''}`,
      result: {
        silhouetteScore: seg.silhouetteScore,
        optimalK: seg.optimalK,
        clusterProfiles: seg.clusterProfiles,
        entities,
      },
      viz: {
        type: 'table',
        title: `${entityType === 'store' ? 'Store' : 'Salesperson'} Segments`,
        columns: ['name', 'tier', 'sales', 'growthPct', 'aov', 'discountRate'],
        rows: entities.slice(0, 12).map((e) => ({
          name: e.name,
          tier: e.tier,
          sales: e.sales,
          growthPct: e.growthPct,
          aov: e.aov,
          discountRate: e.discountRate,
        })),
      },
    };
  }

  if (name === 'explain_trend') {
    const targetYm = String(args.targetYearMonth || '');
    const compareTo = String(args.compareTo || 'previous_month');
    const monthly = aggregateMonthlyTrend(facts, useRecomputed);
    const idx = monthly.findIndex((m) => m.yearMonth === targetYm);
    if (idx === -1) {
      return {
        toolName: name,
        filtersApplied: `Month: ${targetYm}`,
        result: { error: `Month ${targetYm} not found in dataset. Available months: ${monthly[0]?.yearMonth} to ${monthly[monthly.length - 1]?.yearMonth}.` },
      };
    }
    const [y, m] = targetYm.split('-').map(Number);
    const baseYm =
      compareTo === 'same_month_last_year'
        ? `${y - 1}-${String(m).padStart(2, '0')}`
        : idx > 0
        ? monthly[idx - 1].yearMonth
        : '';
    const baseRow = monthly.find((row) => row.yearMonth === baseYm);
    if (!baseRow) {
      return {
        toolName: name,
        filtersApplied: `Month: ${targetYm}`,
        result: { error: `Baseline month (${baseYm || 'prior month'}) is not present in the dataset.` },
      };
    }

    const curFacts = facts.filter((f) => f.yearMonth === targetYm);
    const baseFacts = facts.filter((f) => f.yearMonth === baseYm);
    const curTotals = computeCoreTotals(curFacts, useRecomputed);
    const baseTotals = computeCoreTotals(baseFacts, useRecomputed);

    const breakdownBy = (getter: (r: FactSale) => string) => {
      const keys = new Set([...curFacts.map(getter), ...baseFacts.map(getter)]);
      return Array.from(keys)
        .map((k) => {
          const c = curFacts.filter((r) => getter(r) === k).reduce((a, r) => a + getRowSales(r, useRecomputed), 0);
          const b = baseFacts.filter((r) => getter(r) === k).reduce((a, r) => a + getRowSales(r, useRecomputed), 0);
          return { name: k, current: Number(c.toFixed(2)), baseline: Number(b.toFixed(2)), delta: Number((c - b).toFixed(2)) };
        })
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 6);
    };

    const byCategory = breakdownBy((r) => r.category);
    const byStore = breakdownBy((r) => r.store);
    const byProduct = breakdownBy((r) => r.product);

    return {
      toolName: name,
      filtersApplied: `${targetYm} vs ${baseYm}`,
      result: {
        targetMonth: targetYm,
        baselineMonth: baseYm,
        currentSalesCad: Number(curTotals.sales.toFixed(2)),
        baselineSalesCad: Number(baseTotals.sales.toFixed(2)),
        deltaCad: Number((curTotals.sales - baseTotals.sales).toFixed(2)),
        deltaPct: safeGrowthPct(curTotals.sales, baseTotals.sales) !== null
          ? Number(((safeGrowthPct(curTotals.sales, baseTotals.sales) ?? 0) * 100).toFixed(1))
          : null,
        ordersChange: curTotals.orders - baseTotals.orders,
        aovChangeCad: Number((curTotals.aov - baseTotals.aov).toFixed(2)),
        discountRateChangePts: Number(((curTotals.discountPct - baseTotals.discountPct) * 100).toFixed(2)),
        topCategoryDrivers: byCategory,
        topStoreDrivers: byStore,
        topProductDrivers: byProduct,
      },
      viz: {
        type: 'bar',
        title: `Revenue Change Drivers by Store (${targetYm} vs ${baseYm})`,
        columns: ['label', 'value'],
        rows: byStore.map((s) => ({ label: s.name, value: s.delta })),
        xKey: 'label',
        yKey: 'value',
      },
    };
  }

  return {
    toolName: name,
    filtersApplied: 'None',
    result: { error: `Unknown tool: ${name}` },
  };
}

export function summarizeActiveFilters(filters: GlobalFilters, facts: FactSale[]): string {
  const bounds = getDataDateBounds(facts);
  const parts: string[] = [];
  if (bounds.min && bounds.max) parts.push(`${bounds.min} to ${bounds.max}`);
  if (filters.stores.length) parts.push(`Stores: ${filters.stores.join(', ')}`);
  if (filters.provinces.length) parts.push(`Provinces: ${filters.provinces.join(', ')}`);
  if (filters.categories.length) parts.push(`Categories: ${filters.categories.join(', ')}`);
  if (filters.products.length) parts.push(`Products: ${filters.products.join(', ')}`);
  if (filters.salespeople.length) parts.push(`Reps: ${filters.salespeople.join(', ')}`);
  if (filters.channels.length) parts.push(`Channels: ${filters.channels.join(', ')}`);
  if (filters.excludeOutliers) parts.push('Outliers excluded');
  return parts.join(' · ') || 'All data';
}

export async function askAiAnalyst(params: {
  question: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  facts: FactSale[];
  filters: GlobalFilters;
  trainedModels: AllModelResults;
}): Promise<{
  text: string;
  followUps: string[];
  viz?: ChatMiniViz;
  filtersUsed: string;
  toolsCalled: string[];
}> {
  const { question, history, facts, filters, trainedModels } = params;
  const bounds = getDataDateBounds(facts);
  const datasetContext = {
    dateMin: bounds.min,
    dateMax: bounds.max,
    rowCount: facts.length,
    stores: Array.from(new Set(facts.map((f) => f.store))).sort(),
    provinces: Array.from(new Set(facts.map((f) => f.province))).sort(),
    categories: Array.from(new Set(facts.map((f) => f.category))).sort(),
    channels: Array.from(new Set(facts.map((f) => f.salesChannel))).sort(),
    activeFiltersSummary: summarizeActiveFilters(filters, facts),
  };

  // Build Gemini contents from recent conversation history (last 8 messages)
  const contents: Array<Record<string, unknown>> = history.slice(-8).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }));
  contents.push({ role: 'user', parts: [{ text: question }] });

  const toolsCalled: string[] = [];
  let lastViz: ChatMiniViz | undefined;
  let lastFilterDesc = datasetContext.activeFiltersSummary;

  // Multi-step function calling loop (max 4 tool rounds)
  for (let round = 0; round < 4; round++) {
    const resp = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, datasetContext }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || `AI service error (${resp.status})`);
    }

    const calls = data.functionCalls as Array<{ id?: string; name: string; args?: Record<string, unknown> }> | undefined;

    if (calls && calls.length > 0 && data.modelContent) {
      contents.push(data.modelContent);
      const responseParts: Array<Record<string, unknown>> = [];

      for (const call of calls) {
        toolsCalled.push(call.name);
        const outcome = await executeLocalAnalystTool(
          call.name,
          call.args ?? {},
          facts,
          trainedModels,
          filters.useRecomputedFinancials
        );
        if (outcome.viz) lastViz = outcome.viz;
        lastFilterDesc = outcome.filtersApplied;

        responseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name,
            response: { data: outcome.result },
          },
        });
      }

      contents.push({ role: 'user', parts: responseParts });
      continue;
    }

    // Final text response
    const rawText = String(data.text || '').trim();
    let cleanText = rawText;
    let followUps: string[] = [];

    const fuMatch = rawText.match(/<FOLLOWUPS>([\s\S]*?)<\/FOLLOWUPS>/);
    if (fuMatch) {
      cleanText = rawText.replace(/<FOLLOWUPS>[\s\S]*?<\/FOLLOWUPS>/, '').trim();
      try {
        const parsed = JSON.parse(fuMatch[1].trim());
        if (Array.isArray(parsed)) {
          followUps = parsed.map(String).slice(0, 3);
        }
      } catch {
        followUps = [];
      }
    }

    if (followUps.length === 0) {
      followUps = [
        'Which store had the strongest growth rate?',
        'Show top 5 products by net revenue',
        'What anomalies were detected in pricing or discounts?',
      ];
    }

    return {
      text: cleanText || `Verified ${formatCAD(computeCoreTotals(facts).sales)} across ${facts.length} rows (${formatPct(computeCoreTotals(facts).discountPct)} avg discount).`,
      followUps,
      viz: lastViz,
      filtersUsed: lastFilterDesc,
      toolsCalled,
    };
  }

  throw new Error('The AI Analyst reached the maximum tool execution rounds without producing a final summary.');
}
