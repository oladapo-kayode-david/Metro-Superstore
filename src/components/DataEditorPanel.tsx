import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Package,
  Plus,
  Search,
  Store,
  Table2,
  Trash2,
} from 'lucide-react';
import type { DimProduct, DimSalesperson, DimStore, FactSale } from '../types/sales';
import {
  deleteDimProduct,
  deleteDimStore,
  deleteFactSale,
  upsertDimProduct,
  upsertDimStore,
  upsertFactSale,
} from '../lib/db/database';
import { formatCADExact } from '../lib/analytics/calculations';
import { exportStarSchemaWorkbookXlsx } from '../lib/reports/exporters';
import { TransactionFormModal } from './TransactionFormModal';

interface DataEditorPanelProps {
  allFacts: FactSale[];
  dimStores: DimStore[];
  dimProducts: DimProduct[];
  dimSalespeople: DimSalesperson[];
  onDataMutated: () => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

const PAGE_SIZE = 40;

export const DataEditorPanel: React.FC<DataEditorPanelProps> = ({
  allFacts,
  dimStores,
  dimProducts,
  dimSalespeople,
  onDataMutated,
  onNotify,
}) => {
  const [activeTable, setActiveTable] = useState<'transactions' | 'stores' | 'products'>(
    'transactions'
  );
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Transaction modal state
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FactSale | null>(null);

  // Store inline add/edit form state
  const [editingStoreKey, setEditingStoreKey] = useState<string | null>(null);
  const [storeFormOpen, setStoreFormOpen] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [storeProvince, setStoreProvince] = useState('Ontario');
  const [storeCountry, setStoreCountry] = useState('Canada');

  // Product inline add/edit form state
  const [editingProductKey, setEditingProductKey] = useState<string | null>(null);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [productName, setProductName] = useState('');
  const [productCategory, setProductCategory] = useState('');
  const [productPrice, setProductPrice] = useState('0');

  const storeTxCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of allFacts) {
      map.set(f.store, (map.get(f.store) ?? 0) + 1);
    }
    return map;
  }, [allFacts]);

  const productTxCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of allFacts) {
      map.set(f.product, (map.get(f.product) ?? 0) + 1);
    }
    return map;
  }, [allFacts]);

  const sortedFacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? allFacts.filter(
          (f) =>
            f.transactionId.toLowerCase().includes(q) ||
            f.product.toLowerCase().includes(q) ||
            f.category.toLowerCase().includes(q) ||
            f.store.toLowerCase().includes(q) ||
            f.province.toLowerCase().includes(q) ||
            f.salesperson.toLowerCase().includes(q) ||
            f.date.includes(q) ||
            f.orderId.toLowerCase().includes(q)
        )
      : allFacts;
    return [...filtered].sort((a, b) => b.date.localeCompare(a.date));
  }, [allFacts, search]);

  const totalPages = Math.max(1, Math.ceil(sortedFacts.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedFacts = useMemo(
    () => sortedFacts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sortedFacts, safePage]
  );

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? dimStores.filter(
          (s) =>
            s.store.toLowerCase().includes(q) ||
            s.province.toLowerCase().includes(q) ||
            s.country.toLowerCase().includes(q)
        )
      : dimStores;
    return [...list].sort((a, b) => a.store.localeCompare(b.store));
  }, [dimStores, search]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? dimProducts.filter(
          (p) =>
            p.product.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
        )
      : dimProducts;
    return [...list].sort((a, b) => a.product.localeCompare(b.product));
  }, [dimProducts, search]);

  const handleSaveTransaction = async (fact: FactSale, prevId?: string) => {
    await upsertFactSale(fact, prevId);
    await onDataMutated();
    onNotify(
      prevId
        ? `Updated transaction ${fact.transactionId}.`
        : `Added transaction ${fact.transactionId} (${formatCADExact(fact.salesAmount)}).`,
      'success'
    );
  };

  const handleDeleteTransaction = async (txId: string) => {
    await deleteFactSale(txId);
    await onDataMutated();
    onNotify(`Deleted transaction ${txId}.`, 'info');
  };

  const openNewStoreForm = () => {
    setEditingStoreKey(null);
    setStoreName('');
    setStoreProvince('Ontario');
    setStoreCountry('Canada');
    setStoreFormOpen(true);
  };

  const openEditStoreForm = (s: DimStore) => {
    setEditingStoreKey(s.store);
    setStoreName(s.store);
    setStoreProvince(s.province);
    setStoreCountry(s.country || 'Canada');
    setStoreFormOpen(true);
  };

  const handleSaveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = storeName.trim();
    if (!cleanName) {
      onNotify('Store name is required.', 'error');
      return;
    }
    await upsertDimStore(
      {
        store: cleanName,
        province: storeProvince.trim() || 'Ontario',
        country: storeCountry.trim() || 'Canada',
        source: 'sheet',
      },
      editingStoreKey ?? undefined
    );
    setStoreFormOpen(false);
    setEditingStoreKey(null);
    await onDataMutated();
    onNotify(
      editingStoreKey
        ? `Updated store "${cleanName}" and synced linked transactions.`
        : `Added store "${cleanName}".`,
      'success'
    );
  };

  const handleDeleteStore = async (name: string) => {
    await deleteDimStore(name);
    await onDataMutated();
    onNotify(`Removed store "${name}" from Stores dimension.`, 'info');
  };

  const openNewProductForm = () => {
    setEditingProductKey(null);
    setProductName('');
    setProductCategory('');
    setProductPrice('25');
    setProductFormOpen(true);
  };

  const openEditProductForm = (p: DimProduct) => {
    setEditingProductKey(p.product);
    setProductName(p.product);
    setProductCategory(p.category);
    setProductPrice(String(p.referenceUnitPrice));
    setProductFormOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = productName.trim();
    if (!cleanName) {
      onNotify('Product name is required.', 'error');
      return;
    }
    const priceNum = Math.max(0, Number(productPrice) || 0);
    await upsertDimProduct(
      {
        product: cleanName,
        category: productCategory.trim() || 'General',
        referenceUnitPrice: Math.round(priceNum * 100) / 100,
        source: 'sheet',
      },
      editingProductKey ?? undefined
    );
    setProductFormOpen(false);
    setEditingProductKey(null);
    await onDataMutated();
    onNotify(
      editingProductKey
        ? `Updated product "${cleanName}" and synced linked transactions.`
        : `Added product "${cleanName}".`,
      'success'
    );
  };

  const handleDeleteProduct = async (name: string) => {
    await deleteDimProduct(name);
    await onDataMutated();
    onNotify(`Removed product "${name}" from Products dimension.`, 'info');
  };

  return (
    <section className="space-y-4 rounded-[16px] border border-slate-200/90 bg-white p-5 dark:border-white/10 dark:bg-[#16314D]">
      {/* Header & Table Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4 dark:border-white/10">
        <div>
          <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
            Live Data Editor (Add, Edit &amp; Manage Records)
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Anyone can add, edit, or delete Transactions, Stores, and Products directly—changes update all dashboards instantly.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={allFacts.length === 0 && dimStores.length === 0 && dimProducts.length === 0}
            onClick={() =>
              exportStarSchemaWorkbookXlsx({
                facts: allFacts,
                stores: dimStores,
                products: dimProducts,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export Edited 3-Sheet Excel
          </button>

          {activeTable === 'transactions' && (
            <button
              type="button"
              onClick={() => {
                setEditingTx(null);
                setTxModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg brand-gradient px-3.5 py-1.5 text-xs font-semibold text-[#0F2238] hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Transaction
            </button>
          )}
          {activeTable === 'stores' && (
            <button
              type="button"
              onClick={openNewStoreForm}
              className="inline-flex items-center gap-1.5 rounded-lg brand-gradient px-3.5 py-1.5 text-xs font-semibold text-[#0F2238] hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Store
            </button>
          )}
          {activeTable === 'products' && (
            <button
              type="button"
              onClick={openNewProductForm}
              className="inline-flex items-center gap-1.5 rounded-lg brand-gradient px-3.5 py-1.5 text-xs font-semibold text-[#0F2238] hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Product
            </button>
          )}
        </div>
      </div>

      {/* Worksheet Tabs + Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              {
                id: 'transactions',
                label: `Transactions (${allFacts.length.toLocaleString()})`,
                icon: Table2,
              },
              {
                id: 'stores',
                label: `Stores (${dimStores.length.toLocaleString()})`,
                icon: Store,
              },
              {
                id: 'products',
                label: `Products (${dimProducts.length.toLocaleString()})`,
                icon: Package,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTable === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTable(tab.id);
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border border-[#26E6D0]/60 bg-[#26E6D0]/15 text-[#0F2238] font-semibold dark:text-[#26E6D0]'
                    : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={`Search ${activeTable}…`}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 py-1.5 pl-9 pr-3 text-xs text-[#0F2238] placeholder:text-slate-400 focus:border-[#26E6D0] dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
          />
        </div>
      </div>

      {/* Inline Add/Edit Form for Stores */}
      {activeTable === 'stores' && storeFormOpen && (
        <form
          onSubmit={handleSaveStore}
          className="rounded-xl border border-[#26E6D0]/45 bg-slate-50 p-4 dark:bg-[#0F2238]"
        >
          <div className="text-xs font-semibold text-[#0F2238] dark:text-white">
            {editingStoreKey ? `Edit Store · ${editingStoreKey}` : 'Add New Store'}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-xs">
              <span className="text-slate-600 dark:text-slate-300">Store Name *</span>
              <input
                type="text"
                required
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="e.g. Toronto Downtown"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#16314D] dark:text-white"
              />
            </label>
            <label className="block text-xs">
              <span className="text-slate-600 dark:text-slate-300">Province *</span>
              <input
                type="text"
                required
                value={storeProvince}
                onChange={(e) => setStoreProvince(e.target.value)}
                placeholder="e.g. Ontario"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#16314D] dark:text-white"
              />
            </label>
            <label className="block text-xs">
              <span className="text-slate-600 dark:text-slate-300">Country</span>
              <input
                type="text"
                value={storeCountry}
                onChange={(e) => setStoreCountry(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#16314D] dark:text-white"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setStoreFormOpen(false)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-white/15 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg brand-gradient px-4 py-1.5 text-xs font-semibold text-[#0F2238]"
            >
              {editingStoreKey ? 'Save Store' : 'Add Store'}
            </button>
          </div>
        </form>
      )}

      {/* Inline Add/Edit Form for Products */}
      {activeTable === 'products' && productFormOpen && (
        <form
          onSubmit={handleSaveProduct}
          className="rounded-xl border border-[#26E6D0]/45 bg-slate-50 p-4 dark:bg-[#0F2238]"
        >
          <div className="text-xs font-semibold text-[#0F2238] dark:text-white">
            {editingProductKey ? `Edit Product · ${editingProductKey}` : 'Add New Product'}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-xs">
              <span className="text-slate-600 dark:text-slate-300">Product Name *</span>
              <input
                type="text"
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. Organic Maple Syrup"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#16314D] dark:text-white"
              />
            </label>
            <label className="block text-xs">
              <span className="text-slate-600 dark:text-slate-300">Category *</span>
              <input
                type="text"
                required
                value={productCategory}
                onChange={(e) => setProductCategory(e.target.value)}
                placeholder="e.g. Pantry & Groceries"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-[#0F2238] dark:border-white/15 dark:bg-[#16314D] dark:text-white"
              />
            </label>
            <label className="block text-xs">
              <span className="text-slate-600 dark:text-slate-300">Reference Unit Price (CAD) *</span>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={productPrice}
                onChange={(e) => setProductPrice(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-[#0F2238] tabular-nums dark:border-white/15 dark:bg-[#16314D] dark:text-white"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setProductFormOpen(false)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-white/15 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg brand-gradient px-4 py-1.5 text-xs font-semibold text-[#0F2238]"
            >
              {editingProductKey ? 'Save Product' : 'Add Product'}
            </button>
          </div>
        </form>
      )}

      {/* TABLE 1: TRANSACTIONS */}
      {activeTable === 'transactions' && (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10">
            {pagedFacts.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                {allFacts.length === 0
                  ? 'No transactions yet. Click "Add Transaction" above, upload a file, or link a Google Sheet.'
                  : 'No transactions match your search filter.'}
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 text-slate-600 dark:bg-[#0F2238] dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2 font-medium">Txn ID</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">Store</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Unit Price</th>
                    <th className="px-3 py-2 text-right font-medium">Disc</th>
                    <th className="px-3 py-2 text-right font-medium">Net Sales</th>
                    <th className="hidden px-3 py-2 font-medium xl:table-cell">Rep / Channel</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {pagedFacts.map((f) => (
                    <tr
                      key={f.transactionId}
                      className="hover:bg-slate-50 dark:hover:bg-white/5"
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {f.transactionId}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] tabular-nums">
                        {f.date}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-[#0F2238] dark:text-white">{f.product}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {f.category}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-[#0F2238] dark:text-slate-100">{f.store}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {f.province}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                        {f.quantity}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                        {formatCADExact(f.unitPrice)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {(f.discountRate * 100).toFixed(1)}%
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums text-[#0FA696] dark:text-[#26E6D0]">
                        {formatCADExact(f.salesAmount)}
                      </td>
                      <td className="hidden px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 xl:table-cell">
                        <div>{f.salesperson}</div>
                        <div>{f.salesChannel}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTx(f);
                              setTxModalOpen(true);
                            }}
                            aria-label={`Edit transaction ${f.transactionId}`}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200 hover:text-[#0F2238] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-[#26E6D0]"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteTransaction(f.transactionId)}
                            aria-label={`Delete transaction ${f.transactionId}`}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {sortedFacts.length > PAGE_SIZE && (
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono tabular-nums">
                Showing {(safePage - 1) * PAGE_SIZE + 1}–
                {Math.min(safePage * PAGE_SIZE, sortedFacts.length)} of{' '}
                {sortedFacts.length.toLocaleString()} transactions
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 disabled:opacity-40 dark:border-white/15"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </button>
                <span className="px-2 font-mono tabular-nums">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 disabled:opacity-40 dark:border-white/15"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* TABLE 2: STORES */}
      {activeTable === 'stores' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10">
          {filteredStores.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No stores found. Click &ldquo;Add Store&rdquo; above to create one.
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 dark:bg-[#0F2238] dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2 font-medium">Store</th>
                  <th className="px-3 py-2 font-medium">Province</th>
                  <th className="px-3 py-2 font-medium">Country</th>
                  <th className="px-3 py-2 text-right font-medium">Transactions</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filteredStores.map((s) => (
                  <tr key={s.store} className="hover:bg-slate-50 dark:hover:bg-white/5">
                    <td className="px-3 py-2.5 font-medium text-[#0F2238] dark:text-white">
                      {s.store}
                    </td>
                    <td className="px-3 py-2.5">{s.province}</td>
                    <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">
                      {s.country || 'Canada'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {(storeTxCounts.get(s.store) ?? 0).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditStoreForm(s)}
                          aria-label={`Edit store ${s.store}`}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200 hover:text-[#0F2238] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-[#26E6D0]"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteStore(s.store)}
                          aria-label={`Delete store ${s.store}`}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* TABLE 3: PRODUCTS */}
      {activeTable === 'products' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10">
          {filteredProducts.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No products found. Click &ldquo;Add Product&rdquo; above to create one.
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 dark:bg-[#0F2238] dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Reference Price (CAD)</th>
                  <th className="px-3 py-2 text-right font-medium">Transactions</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filteredProducts.map((p) => (
                  <tr key={p.product} className="hover:bg-slate-50 dark:hover:bg-white/5">
                    <td className="px-3 py-2.5 font-medium text-[#0F2238] dark:text-white">
                      {p.product}
                    </td>
                    <td className="px-3 py-2.5">{p.category}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {formatCADExact(p.referenceUnitPrice)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {(productTxCounts.get(p.product) ?? 0).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditProductForm(p)}
                          aria-label={`Edit product ${p.product}`}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200 hover:text-[#0F2238] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-[#26E6D0]"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteProduct(p.product)}
                          aria-label={`Delete product ${p.product}`}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <TransactionFormModal
        open={txModalOpen}
        editingFact={editingTx}
        dimProducts={dimProducts}
        dimStores={dimStores}
        dimSalespeople={dimSalespeople}
        onClose={() => {
          setTxModalOpen(false);
          setEditingTx(null);
        }}
        onSave={handleSaveTransaction}
      />
    </section>
  );
};
