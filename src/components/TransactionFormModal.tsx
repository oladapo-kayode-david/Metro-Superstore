import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Save, X } from 'lucide-react';
import type { DimProduct, DimSalesperson, DimStore, FactSale } from '../types/sales';
import { formatCADExact } from '../lib/analytics/calculations';

interface TransactionFormModalProps {
  open: boolean;
  editingFact: FactSale | null;
  dimProducts: DimProduct[];
  dimStores: DimStore[];
  dimSalespeople: DimSalesperson[];
  onClose: () => void;
  onSave: (fact: FactSale, previousTransactionId?: string) => Promise<void>;
}

const CANADIAN_PROVINCES = [
  'Ontario',
  'Quebec',
  'British Columbia',
  'Alberta',
  'Manitoba',
  'Saskatchewan',
  'Nova Scotia',
  'New Brunswick',
  'Newfoundland and Labrador',
  'Prince Edward Island',
];

const DEFAULT_CHANNELS = ['In-Store', 'Online', 'Mobile App', 'B2B / Corporate'];
const DEFAULT_PAYMENTS = ['Credit Card', 'Debit Card', 'Cash', 'E-Transfer', 'Gift Card'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function generateId(prefix: string): string {
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${rand}`;
}

export const TransactionFormModal: React.FC<TransactionFormModalProps> = ({
  open,
  editingFact,
  dimProducts,
  dimStores,
  dimSalespeople,
  onClose,
  onSave,
}) => {
  const [transactionId, setTransactionId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [date, setDate] = useState('');
  const [product, setProduct] = useState('');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('0');
  const [discountPct, setDiscountPct] = useState('0');
  const [store, setStore] = useState('');
  const [province, setProvince] = useState('Ontario');
  const [salesChannel, setSalesChannel] = useState('In-Store');
  const [paymentMethod, setPaymentMethod] = useState('Credit Card');
  const [salesperson, setSalesperson] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productLookup = useMemo(
    () => new Map(dimProducts.map((p) => [p.product.toLowerCase(), p])),
    [dimProducts]
  );
  const storeLookup = useMemo(
    () => new Map(dimStores.map((s) => [s.store.toLowerCase(), s])),
    [dimStores]
  );
  const existingCategories = useMemo(
    () => Array.from(new Set(dimProducts.map((p) => p.category).filter(Boolean))).sort(),
    [dimProducts]
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingFact) {
      setTransactionId(editingFact.transactionId);
      setOrderId(editingFact.orderId);
      setDate(editingFact.date);
      setProduct(editingFact.product);
      setCategory(editingFact.category);
      setQuantity(String(editingFact.quantity));
      setUnitPrice(String(editingFact.unitPrice));
      setDiscountPct(String(round2(editingFact.discountRate * 100)));
      setStore(editingFact.store);
      setProvince(editingFact.province);
      setSalesChannel(editingFact.salesChannel);
      setPaymentMethod(editingFact.paymentMethod);
      setSalesperson(editingFact.salesperson);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const firstStore = dimStores[0];
      const firstProduct = dimProducts[0];
      setTransactionId(generateId('TXN'));
      setOrderId(generateId('ORD'));
      setDate(today);
      setProduct(firstProduct?.product || '');
      setCategory(firstProduct?.category || '');
      setQuantity('1');
      setUnitPrice(firstProduct ? String(firstProduct.referenceUnitPrice) : '25');
      setDiscountPct('0');
      setStore(firstStore?.store || '');
      setProvince(firstStore?.province || 'Ontario');
      setSalesChannel('In-Store');
      setPaymentMethod('Credit Card');
      setSalesperson(dimSalespeople[0]?.salesperson || '');
    }
  }, [open, editingFact, dimProducts, dimStores, dimSalespeople]);

  const parsedQty = Number(quantity) || 0;
  const parsedPrice = Math.max(0, Number(unitPrice) || 0);
  const parsedDiscountRate = Math.min(1, Math.max(0, (Number(discountPct) || 0) / 100));
  const grossSales = round2(parsedQty * parsedPrice);
  const discountAmount = round2(grossSales * parsedDiscountRate);
  const salesAmount = round2(grossSales - discountAmount);

  if (!open) return null;

  const handleProductChange = (val: string) => {
    setProduct(val);
    const match = productLookup.get(val.trim().toLowerCase());
    if (match) {
      setCategory(match.category);
      if (!editingFact || Number(unitPrice) === 0) {
        setUnitPrice(String(match.referenceUnitPrice));
      }
    }
  };

  const handleStoreChange = (val: string) => {
    setStore(val);
    const match = storeLookup.get(val.trim().toLowerCase());
    if (match) {
      setProvince(match.province);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanTxId = transactionId.trim() || generateId('TXN');
    const cleanDate = date.trim();
    const cleanProduct = product.trim();
    const cleanStore = store.trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      setError('Please select a valid date (YYYY-MM-DD).');
      return;
    }
    if (!cleanProduct) {
      setError('Product name is required.');
      return;
    }
    if (!cleanStore) {
      setError('Store name is required.');
      return;
    }
    if (!Number.isFinite(parsedQty) || parsedQty === 0) {
      setError('Quantity must be a non-zero number (use negative quantity for a return).');
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError('Unit Price must be 0 or greater.');
      return;
    }

    const [yStr, mStr] = cleanDate.split('-');
    const year = Number(yStr);
    const month = Number(mStr);
    const quarter = Math.ceil(month / 3);
    const yearMonth = `${yStr}-${mStr}`;

    const matchedProd = productLookup.get(cleanProduct.toLowerCase());
    const refPrice = matchedProd?.referenceUnitPrice || parsedPrice;
    const priceDeviationPct =
      refPrice > 0 ? round2(((parsedPrice - refPrice) / refPrice) * 100) : 0;

    const matchedStore = storeLookup.get(cleanStore.toLowerCase());

    const nextFact: FactSale = {
      transactionId: cleanTxId,
      date: cleanDate,
      yearMonth,
      year,
      quarter,
      month,
      product: cleanProduct,
      category: category.trim() || matchedProd?.category || 'General',
      quantity: parsedQty,
      unitPrice: round2(parsedPrice),
      discountRate: round2(parsedDiscountRate * 10000) / 10000,
      grossSales,
      discountAmount,
      salesAmount,
      originalGrossSales: grossSales,
      originalDiscountAmount: discountAmount,
      originalSalesAmount: salesAmount,
      store: cleanStore,
      province: province.trim() || matchedStore?.province || 'Ontario',
      country: matchedStore?.country || 'Canada',
      salesChannel: salesChannel.trim() || 'In-Store',
      paymentMethod: paymentMethod.trim() || 'Credit Card',
      salesperson: salesperson.trim() || 'Unassigned',
      orderId: orderId.trim() || cleanTxId,
      isReturn: parsedQty < 0,
      isOutlier: editingFact?.isOutlier ?? false,
      outlierReasons: editingFact?.outlierReasons ?? [],
      isPriceAnomaly: Math.abs(priceDeviationPct) > 25,
      priceDeviationPct,
      isCategoryMismatch: false,
      hasReconciliationDiff: false,
      imputedFields: [],
      uploadBatchId: editingFact?.uploadBatchId || `manual-${Date.now()}`,
    };

    setSaving(true);
    try {
      await onSave(nextFact, editingFact?.transactionId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save transaction.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editingFact ? 'Edit Sales Transaction' : 'Add New Sales Transaction'}
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-[#0F2238]/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[18px] border border-slate-200/90 bg-white shadow-2xl dark:border-white/15 dark:bg-[#16314D]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="font-display text-base font-bold text-[#0F2238] dark:text-white">
              {editingFact ? `Edit Transaction · ${editingFact.transactionId}` : 'Add Sales Transaction'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Updates all KPIs, charts, star schema tables, and forecasts immediately
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close transaction form"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#0F2238] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Transaction ID <span className="text-rose-500">*</span>
              </span>
              <input
                type="text"
                required
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-[#0F2238] focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
              />
            </label>

            <label className="block text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Date <span className="text-rose-500">*</span>
              </span>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-[#0F2238] focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
              />
            </label>

            <label className="block text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Product <span className="text-rose-500">*</span>
              </span>
              <input
                type="text"
                required
                list="ms-product-list"
                value={product}
                onChange={(e) => handleProductChange(e.target.value)}
                placeholder="Select or type new product"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-[#0F2238] focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
              />
              <datalist id="ms-product-list">
                {dimProducts.map((p) => (
                  <option key={p.product} value={p.product} />
                ))}
              </datalist>
            </label>

            <label className="block text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">Category</span>
              <input
                type="text"
                list="ms-category-list"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Groceries, Electronics"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-[#0F2238] focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
              />
              <datalist id="ms-category-list">
                {existingCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>

            <label className="block text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Store <span className="text-rose-500">*</span>
              </span>
              <input
                type="text"
                required
                list="ms-store-list"
                value={store}
                onChange={(e) => handleStoreChange(e.target.value)}
                placeholder="Select or type new store"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-[#0F2238] focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
              />
              <datalist id="ms-store-list">
                {dimStores.map((s) => (
                  <option key={s.store} value={s.store} />
                ))}
              </datalist>
            </label>

            <label className="block text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">Province</span>
              <input
                type="text"
                list="ms-province-list"
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-[#0F2238] focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
              />
              <datalist id="ms-province-list">
                {CANADIAN_PROVINCES.map((prov) => (
                  <option key={prov} value={prov} />
                ))}
              </datalist>
            </label>

            <div className="grid grid-cols-3 gap-2.5 sm:col-span-2">
              <label className="block text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Quantity <span className="text-rose-500">*</span>
                </span>
                <input
                  type="number"
                  step="1"
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-[#0F2238] tabular-nums focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
                />
              </label>

              <label className="block text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Unit Price (CAD) <span className="text-rose-500">*</span>
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-[#0F2238] tabular-nums focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
                />
              </label>

              <label className="block text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Discount (%)
                </span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={discountPct}
                  onChange={(e) => setDiscountPct(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-[#0F2238] tabular-nums focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
                />
              </label>
            </div>

            <label className="block text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">Sales Channel</span>
              <input
                type="text"
                list="ms-channel-list"
                value={salesChannel}
                onChange={(e) => setSalesChannel(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-[#0F2238] focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
              />
              <datalist id="ms-channel-list">
                {DEFAULT_CHANNELS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>

            <label className="block text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">Payment Method</span>
              <input
                type="text"
                list="ms-payment-list"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-[#0F2238] focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
              />
              <datalist id="ms-payment-list">
                {DEFAULT_PAYMENTS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </label>

            <label className="block text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">Salesperson</span>
              <input
                type="text"
                list="ms-rep-list"
                value={salesperson}
                onChange={(e) => setSalesperson(e.target.value)}
                placeholder="Select or type salesperson"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-[#0F2238] focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
              />
              <datalist id="ms-rep-list">
                {dimSalespeople.map((r) => (
                  <option key={r.salesperson} value={r.salesperson} />
                ))}
              </datalist>
            </label>

            <label className="block text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">Order ID</span>
              <input
                type="text"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-[#0F2238] focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
              />
            </label>
          </div>

          {/* Live Calculated Totals Preview */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#26E6D0]/35 bg-slate-50 px-4 py-3 text-xs dark:bg-[#0F2238]">
            <div className="inline-flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300">
              <Calculator className="h-3.5 w-3.5 text-[#0FB8A5] dark:text-[#26E6D0]" aria-hidden="true" />
              Auto-Calculated Totals
            </div>
            <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
              <span className="text-slate-600 dark:text-slate-300">
                Gross: <strong>{formatCADExact(grossSales)}</strong>
              </span>
              <span className="text-slate-600 dark:text-slate-300">
                Discount: <strong>-{formatCADExact(discountAmount)}</strong>
              </span>
              <span className="text-[#0FA696] dark:text-[#26E6D0]">
                Net Sales: <strong>{formatCADExact(salesAmount)}</strong>
              </span>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg brand-gradient px-5 py-2 text-xs font-semibold text-[#0F2238] hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              {saving ? 'Saving…' : editingFact ? 'Save Changes' : 'Add Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
