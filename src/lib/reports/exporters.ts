import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import type {
  AllModelResults,
  DataQualityReport,
  FactSale,
  GlobalFilters,
  PinnedInsight,
  RecommendationsBundle,
} from '../../types/sales';
import {
  aggregateCategories,
  aggregateMonthlyTrend,
  aggregateProductPareto,
  aggregateProvinces,
  aggregateSalespeople,
  aggregateStores,
  computeCoreTotals,
  formatCAD,
  formatCADExact,
  formatPct,
  getDataDateBounds,
} from '../analytics/calculations';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportRowsToCsv(rows: Array<Record<string, unknown>>, filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
}

export function exportRowsToJson(data: unknown, filename: string) {
  triggerDownload(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
}

export async function downloadElementAsPng(element: HTMLElement, filename: string) {
  const canvas = await html2canvas(element, {
    backgroundColor: document.documentElement.classList.contains('dark') ? '#16314D' : '#FFFFFF',
    scale: 2,
    logging: false,
  });
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function downloadDataQualityReport(report: DataQualityReport) {
  const wb = XLSX.utils.book_new();
  const summaryRows = [
    { Metric: 'Report ID', Value: report.id },
    { Metric: 'Timestamp', Value: report.timestamp },
    { Metric: 'Files Processed', Value: report.filesProcessed.join(', ') },
    { Metric: 'Quality Score (/100)', Value: report.qualityScore },
    { Metric: 'Rows Read', Value: report.rowsRead },
    { Metric: 'Rows Cleaned', Value: report.rowsCleaned },
    { Metric: 'Rows Rejected', Value: report.rowsRejected },
    { Metric: 'Duplicates Removed', Value: report.duplicatesRemoved },
    { Metric: 'Imputed Fields', Value: report.imputedCount },
    { Metric: 'Outliers Flagged', Value: report.outliersFlagged },
    { Metric: 'Returns Flagged (Qty < 0)', Value: report.returnsFlagged },
    { Metric: 'Financial Reconciliation Diffs (>0.01 CAD)', Value: report.reconciliationDiffs },
    { Metric: 'Price Anomalies (>±25%)', Value: report.priceAnomalies },
    { Metric: 'Category Mismatches', Value: report.categoryMismatches },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  if (report.actions.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(report.actions), 'Cleaning Log');
  }
  if (report.merges.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(report.merges), 'Label Merges');
  }
  XLSX.writeFile(wb, `Data_Quality_Report_${report.timestamp.slice(0, 10)}.xlsx`);
}

export function downloadRejectedRowsCsv(report: DataQualityReport) {
  if (report.rejectedRows.length === 0) return;
  const rows = report.rejectedRows.map((r) => ({
    Row_Index: r.rowIndex,
    Source_File: r.sourceFile,
    Rejection_Reason: r.reason,
    Raw_JSON: JSON.stringify(r.rawData),
  }));
  exportRowsToCsv(rows, `Rejected_Rows_${report.timestamp.slice(0, 10)}.csv`);
}

export function exportExecutiveWorkbookExcel(params: {
  facts: FactSale[];
  models: AllModelResults;
  recommendations: RecommendationsBundle | null;
  useRecomputed: boolean;
}) {
  const { facts, models, recommendations, useRecomputed } = params;
  const wb = XLSX.utils.book_new();
  const totals = computeCoreTotals(facts, useRecomputed);
  const bounds = getDataDateBounds(facts);

  // 1. Summary
  const summary = [
    { KPI: 'Report Generated', Value: new Date().toISOString().slice(0, 10) },
    { KPI: 'Data Coverage', Value: `${bounds.min} to ${bounds.max}` },
    { KPI: 'Total Sales (CAD)', Value: Number(totals.sales.toFixed(2)) },
    { KPI: 'Gross Sales (CAD)', Value: Number(totals.grossSales.toFixed(2)) },
    { KPI: 'Total Discounts (CAD)', Value: Number(totals.discountAmount.toFixed(2)) },
    { KPI: 'Effective Discount %', Value: Number((totals.discountPct * 100).toFixed(2)) },
    { KPI: 'Total Quantity', Value: totals.quantity },
    { KPI: 'Distinct Orders', Value: totals.orders },
    { KPI: 'Average Order Value (CAD)', Value: Number(totals.aov.toFixed(2)) },
    { KPI: 'Avg Units per Order', Value: Number(totals.avgUnitsPerOrder.toFixed(2)) },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');

  // 2. Monthly Trend
  const monthly = aggregateMonthlyTrend(facts, useRecomputed).map((m) => ({
    'Year-Month': m.yearMonth,
    'Sales (CAD)': m.sales,
    'Gross Sales (CAD)': m.grossSales,
    'Discounts (CAD)': m.discountAmount,
    'Discount %': Number((m.discountPct * 100).toFixed(2)),
    Quantity: m.quantity,
    Orders: m.orders,
    'AOV (CAD)': Number(m.aov.toFixed(2)),
    'MoM %': m.momPct !== null ? Number((m.momPct * 100).toFixed(2)) : '',
    'YoY %': m.yoyPct !== null ? Number((m.yoyPct * 100).toFixed(2)) : '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthly), 'Monthly Trend');

  // 3. Product
  const products = aggregateProductPareto(facts, useRecomputed).map((p) => ({
    Rank: p.rank,
    Product: p.product,
    Category: p.category,
    'Sales (CAD)': p.sales,
    Quantity: p.quantity,
    Orders: p.orders,
    'Avg Price (CAD)': Number(p.avgPrice.toFixed(2)),
    'Discount %': Number((p.discountPct * 100).toFixed(2)),
    'Share %': Number((p.sharePct * 100).toFixed(2)),
    'Cumulative %': Number((p.cumulativePct * 100).toFixed(2)),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(products), 'Product');

  // 4. Category
  const categories = aggregateCategories(facts, useRecomputed).map((c) => ({
    Category: c.category,
    'Sales (CAD)': c.sales,
    Quantity: c.quantity,
    Orders: c.orders,
    'Share %': Number((c.sharePct * 100).toFixed(2)),
    'Discount %': Number((c.discountPct * 100).toFixed(2)),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categories), 'Category');

  // 5. Store
  const stores = aggregateStores(facts, useRecomputed).map((s) => ({
    Store: s.store,
    Province: s.province,
    Country: s.country,
    'Sales (CAD)': s.sales,
    Quantity: s.quantity,
    Orders: s.orders,
    'AOV (CAD)': Number(s.aov.toFixed(2)),
    'Discount %': Number((s.discountPct * 100).toFixed(2)),
    'Share %': Number((s.sharePct * 100).toFixed(2)),
    'Growth %': s.growthPct !== null ? Number((s.growthPct * 100).toFixed(2)) : '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stores), 'Store');

  // 6. Province
  const provinces = aggregateProvinces(facts, useRecomputed).map((p) => ({
    Province: p.province,
    Stores: p.storeCount,
    'Sales (CAD)': p.sales,
    Quantity: p.quantity,
    Orders: p.orders,
    'Discount %': Number((p.discountPct * 100).toFixed(2)),
    'Share %': Number((p.sharePct * 100).toFixed(2)),
    'Growth %': p.growthPct !== null ? Number((p.growthPct * 100).toFixed(2)) : '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(provinces), 'Province');

  // 7. Salesperson
  const reps = aggregateSalespeople(facts, useRecomputed).map((r) => ({
    Rank: r.rank,
    Salesperson: r.salesperson,
    'Primary Store': r.primaryStore,
    Province: r.province,
    'Sales (CAD)': r.sales,
    Quantity: r.quantity,
    Orders: r.orders,
    'AOV (CAD)': Number(r.aov.toFixed(2)),
    'Discount %': Number((r.discountPct * 100).toFixed(2)),
    'Growth %': r.growthPct !== null ? Number((r.growthPct * 100).toFixed(2)) : '',
    Quartile: r.quartile,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reps), 'Salesperson');

  // 8. Forecast
  if (models.forecast?.sufficientData) {
    const fcRows = models.forecast.points.map((pt) => ({
      'Year-Month': pt.yearMonth,
      Type: pt.isForecast ? 'Forecast' : 'Historical',
      'Actual Sales (CAD)': pt.actual ?? '',
      'Predicted Sales (CAD)': pt.predicted ?? '',
      'Lower 80% (CAD)': pt.lower80 ?? '',
      'Upper 80% (CAD)': pt.upper80 ?? '',
      'Lower 95% (CAD)': pt.lower95 ?? '',
      'Upper 95% (CAD)': pt.upper95 ?? '',
      'Predicted Qty': pt.quantityPredicted ?? '',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fcRows), 'Forecast');
  } else {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ Note: 'Train the Sales Forecast model in Model Lab to populate forecasts.' }]),
      'Forecast'
    );
  }

  // 9. Recommendations
  if (recommendations && recommendations.recommendations.length > 0) {
    const recRows = recommendations.recommendations.map((r) => ({
      Priority: r.priority,
      Score: r.priorityScore,
      Title: r.title,
      Target: `${r.targetType}: ${r.targetName}`,
      Status: r.status,
      'Low Uplift (CAD)': r.expectedImpact.lowCad,
      'Base Uplift (CAD)': r.expectedImpact.baseCad,
      'High Uplift (CAD)': r.expectedImpact.highCad,
      Assumptions: r.expectedImpact.assumptions,
      Evidence: r.evidence.join(' | '),
      'Root Cause': r.rootCauseHypothesis,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recRows), 'Recommendations');
  } else {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ Note: 'Generate Retention Recommendations to populate this sheet.' }]),
      'Recommendations'
    );
  }

  XLSX.writeFile(wb, `Sales_Intelligence_Executive_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function exportExecutiveReportPdf(params: {
  facts: FactSale[];
  filters: GlobalFilters;
  models: AllModelResults;
  recommendations: RecommendationsBundle | null;
  qualityReport: DataQualityReport | null;
  pinnedInsights: PinnedInsight[];
  captureElement?: HTMLElement | null;
}) {
  const { facts, filters, models, recommendations, qualityReport, pinnedInsights, captureElement } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const bounds = getDataDateBounds(facts);
  const totals = computeCoreTotals(facts, filters.useRecomputedFinancials);
  const stores = aggregateStores(facts, filters.useRecomputedFinancials);
  const categories = aggregateCategories(facts, filters.useRecomputedFinancials);
  const reps = aggregateSalespeople(facts, filters.useRecomputedFinancials);

  // Page 1: Branded Cover Page
  doc.setFillColor(15, 34, 56); // #0F2238
  doc.rect(0, 0, pageW, pageH, 'F');
  doc.setFillColor(38, 230, 208); // #26E6D0
  doc.rect(48, 96, 84, 5, 'F');
  doc.setFillColor(183, 64, 222); // #B740DE
  doc.rect(132, 96, 56, 5, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text('Sales Intelligence Platform', 48, 150);
  doc.setFontSize(16);
  doc.setTextColor(38, 230, 208);
  doc.text('Executive Performance, ML Forecast & Retention Report', 48, 180);

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Generated: ${new Date().toISOString().slice(0, 10)}`, 48, 235);
  doc.text(`Data Coverage: ${bounds.min || 'N/A'} to ${bounds.max || 'N/A'}`, 48, 255);
  doc.text(`Transactions Analyzed: ${facts.length.toLocaleString('en-CA')} (Currency: CAD)`, 48, 275);

  const filterSummary = [
    filters.stores.length ? `Stores: ${filters.stores.join(', ')}` : 'All Stores',
    filters.provinces.length ? `Provinces: ${filters.provinces.join(', ')}` : 'All Provinces',
    filters.categories.length ? `Categories: ${filters.categories.join(', ')}` : 'All Categories',
  ].join(' | ');
  doc.text(`Active Filter Context: ${filterSummary}`, 48, 295, { maxWidth: pageW - 96 });

  // Cover KPI highlight strip
  doc.setFillColor(22, 49, 77); // #16314D
  doc.roundedRect(48, 345, pageW - 96, 150, 10, 10, 'F');
  const kpiBlocks = [
    { label: 'Total Sales (CAD)', val: formatCAD(totals.sales) },
    { label: 'Distinct Orders', val: totals.orders.toLocaleString('en-CA') },
    { label: 'Average Order Value', val: formatCADExact(totals.aov) },
    { label: 'Effective Discount %', val: formatPct(totals.discountPct) },
  ];
  kpiBlocks.forEach((k, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 72 + col * 240;
    const y = 385 + row * 65;
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(10);
    doc.text(k.label, x, y);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(k.val, x, y + 22);
    doc.setFont('helvetica', 'normal');
  });

  // Page 2: Executive KPI Breakdown & Top Stores / Categories / Reps
  doc.addPage();
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, pageH, 'F');
  let y = 52;

  const sectionHeader = (title: string) => {
    if (y > pageH - 110) {
      doc.addPage();
      y = 52;
    }
    doc.setTextColor(15, 34, 56);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(title, 44, y);
    doc.setDrawColor(38, 230, 208);
    doc.setLineWidth(1.5);
    doc.line(44, y + 6, 160, y + 6);
    y += 24;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
  };

  sectionHeader('1. Top Stores & Categories Breakdown');
  doc.setFont('helvetica', 'bold');
  doc.text('Store', 44, y);
  doc.text('Province', 195, y);
  doc.text('Sales (CAD)', 315, y);
  doc.text('Orders', 405, y);
  doc.text('Discount %', 465, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  stores.slice(0, 8).forEach((s) => {
    doc.text(s.store.slice(0, 26), 44, y);
    doc.text(s.province.slice(0, 20), 195, y);
    doc.text(formatCAD(s.sales), 315, y);
    doc.text(String(s.orders), 405, y);
    doc.text(formatPct(s.discountPct), 465, y);
    y += 15;
  });

  y += 14;
  doc.setFont('helvetica', 'bold');
  doc.text('Category', 44, y);
  doc.text('Sales (CAD)', 210, y);
  doc.text('Share %', 320, y);
  doc.text('Quantity', 400, y);
  doc.text('Discount %', 465, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  categories.slice(0, 6).forEach((c) => {
    doc.text(c.category, 44, y);
    doc.text(formatCAD(c.sales), 210, y);
    doc.text(formatPct(c.sharePct), 320, y);
    doc.text(String(c.quantity), 400, y);
    doc.text(formatPct(c.discountPct), 465, y);
    y += 15;
  });

  y += 14;
  sectionHeader('2. Top Salespeople');
  reps.slice(0, 6).forEach((r) => {
    doc.text(
      `#${r.rank} ${r.salesperson} (${r.primaryStore}) — ${formatCAD(r.sales)} | ${r.orders} orders | AOV ${formatCADExact(r.aov)} | Disc ${formatPct(r.discountPct)}`,
      44,
      y
    );
    y += 15;
  });

  // Optional visual snapshot capture if provided
  if (captureElement) {
    try {
      const canvas = await html2canvas(captureElement, { scale: 1.5, logging: false });
      const imgData = canvas.toDataURL('image/png');
      doc.addPage();
      y = 52;
      sectionHeader('3. Visual Executive Snapshot');
      const imgW = pageW - 88;
      const imgH = Math.min(pageH - 120, (canvas.height / canvas.width) * imgW);
      doc.addImage(imgData, 'PNG', 44, y, imgW, imgH);
    } catch {
      // Skip snapshot if canvas capture is unavailable
    }
  }

  // ML Model Results
  doc.addPage();
  y = 52;
  sectionHeader('4. Machine Learning Model Lab Summary');
  if (models.forecast?.sufficientData) {
    doc.setFont('helvetica', 'bold');
    doc.text(`Sales Forecast (${models.forecast.method})`, 44, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(
      `Metrics: MAE ${formatCAD(models.forecast.metrics.mae)}, RMSE ${formatCAD(models.forecast.metrics.rmse)}, MAPE ${models.forecast.metrics.mape}%, R² ${models.forecast.metrics.r2}. ${models.forecast.plainEnglish}`,
      pageW - 88
    );
    doc.text(lines, 44, y);
    y += lines.length * 13 + 10;
  } else {
    doc.text('Sales Forecast: Not trained yet in current session.', 44, y);
    y += 18;
  }
  if (models.anomalies?.sufficientData) {
    const lines = doc.splitTextToSize(`Anomaly Detection: ${models.anomalies.plainEnglish}`, pageW - 88);
    doc.text(lines, 44, y);
    y += lines.length * 13 + 8;
  }
  if (models.discountImpact?.sufficientData) {
    const lines = doc.splitTextToSize(`Discount Impact: ${models.discountImpact.plainEnglish}`, pageW - 88);
    doc.text(lines, 44, y);
    y += lines.length * 13 + 8;
  }
  if (models.basketAffinity?.sufficientData) {
    const lines = doc.splitTextToSize(`Basket Affinity: ${models.basketAffinity.plainEnglish}`, pageW - 88);
    doc.text(lines, 44, y);
    y += lines.length * 13 + 12;
  }

  // Recommendations
  sectionHeader('5. Retention Recommendations & Priority Actions');
  if (recommendations && recommendations.recommendations.length > 0) {
    const sumLines = doc.splitTextToSize(
      `Revenue at Risk: ${formatCAD(recommendations.totalRevenueAtRisk)} | Opportunity Value: ${formatCAD(recommendations.totalOpportunityValue)}. ${recommendations.executiveSummary}`,
      pageW - 88
    );
    doc.text(sumLines, 44, y);
    y += sumLines.length * 13 + 12;

    recommendations.recommendations.slice(0, 6).forEach((rec, i) => {
      if (y > pageH - 100) {
        doc.addPage();
        y = 52;
      }
      doc.setFont('helvetica', 'bold');
      doc.text(`${i + 1}. [${rec.priority}] ${rec.title} — ${rec.targetType}: ${rec.targetName}`, 44, y, {
        maxWidth: pageW - 88,
      });
      y += 14;
      doc.setFont('helvetica', 'normal');
      const ev = doc.splitTextToSize(
        `Evidence: ${rec.evidence.join(' ')} | Expected Base Uplift: ${formatCAD(rec.expectedImpact.baseCad)} (${rec.expectedImpact.assumptions})`,
        pageW - 88
      );
      doc.text(ev, 44, y);
      y += ev.length * 12 + 10;
    });
  } else {
    doc.text('No retention recommendations generated yet.', 44, y);
    y += 18;
  }

  // Pinned AI Insights
  const reportPins = pinnedInsights.filter((p) => p.inReport);
  if (reportPins.length > 0) {
    sectionHeader('6. AI Analyst Report Additions');
    reportPins.forEach((p) => {
      if (y > pageH - 90) {
        doc.addPage();
        y = 52;
      }
      doc.setFont('helvetica', 'bold');
      doc.text(p.title, 44, y);
      y += 13;
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(`${p.summary} (Scope: ${p.filtersUsed})`, pageW - 88);
      doc.text(lines, 44, y);
      y += lines.length * 12 + 10;
    });
  }

  // Data Quality Appendix
  sectionHeader('Appendix: Data Quality & Validation Summary');
  if (qualityReport) {
    const dqLines = [
      `Data Quality Score: ${qualityReport.qualityScore} / 100`,
      `Rows Read: ${qualityReport.rowsRead.toLocaleString()} | Rows Cleaned: ${qualityReport.rowsCleaned.toLocaleString()} | Rows Rejected: ${qualityReport.rowsRejected.toLocaleString()}`,
      `Duplicates Removed: ${qualityReport.duplicatesRemoved} | Imputations: ${qualityReport.imputedCount} | Outliers Flagged: ${qualityReport.outliersFlagged}`,
      `Financial Reconciliation Diffs (>0.01 CAD): ${qualityReport.reconciliationDiffs} | Price Anomalies (>±25%): ${qualityReport.priceAnomalies}`,
    ];
    dqLines.forEach((l) => {
      doc.text(l, 44, y);
      y += 14;
    });
  } else {
    doc.text('Data quality metrics available after ingestion in Data Manager.', 44, y);
  }

  doc.save(`Sales_Intelligence_Executive_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
}
