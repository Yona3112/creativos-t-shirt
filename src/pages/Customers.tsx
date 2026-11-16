import { useMemo, useState } from 'react';
import type { Address, Customer, Section } from '../lib/types';
import { useAppState } from '../lib/store';
import { addressText, deleteCustomer, saveCustomer } from '../lib/actions';
import { copyText } from '../lib/csv';
import { uid } from '../lib/ids';
import { money } from '../lib/money';
import { Confirm, Empty, Modal, toast } from '../components/ui';

type CustomerStats = {
  orderCount: number;
  totalSpent: number;
  balanceDue: number;
  topSize: string | null;
};

export default function Customers({ navigate }: { navigate?: (s: Section) => void }) {
  const state = useAppState();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null);

  const statsByCustomer = useMemo(() => {
    const map = new Map<string, CustomerStats>();
    const activeCustomers = state.customers.filter((c) => !c.deleted);
    const phoneToCustomerId = new Map<string, string>();
    for (const c of activeCustomers) {
      const digits = (c.phone || '').replace(/\D/g, '');
      if (digits.length >= 8) phoneToCustomerId.set(digits.slice(-8), c.id);
    }

    const sizeCounts = new Map<string, Map<string, number>>();
    for (const o of state.orders) {
      if (o.deleted || o.status === 'cancelado' || o.status === 'borrador') continue;
      const digits = (o.shipTo?.phone || '').replace(/\D/g, '');
      const cid =
        (o.customerId && activeCustomers.some((c) => c.id === o.customerId) ? o.customerId : null) ||
        (digits.length >= 8 ? phoneToCustomerId.get(digits.slice(-8)) || null : null);
      if (!cid) continue;

      const cur = map.get(cid) || { orderCount: 0, totalSpent: 0, balanceDue: 0, topSize: null };
      cur.orderCount += 1;
      cur.totalSpent += o.total;
      if (o.balance > 0) cur.balanceDue += o.balance;
      map.set(cid, cur);

      let sc = sizeCounts.get(cid);
      if (!sc) {
        sc = new Map<string, number>();
        sizeCounts.set(cid, sc);
      }
      for (const it of o.items) {
        if (!it.size) continue;
        sc.set(it.size, (sc.get(it.size) || 0) + Math.max(1, it.qty || 1));
      }
    }

    for (const [cid, cur] of map.entries()) {
      const sc = sizeCounts.get(cid);
      if (sc && sc.size > 0) {
        let bestSize: string | null = null;
        let bestQty = -1;
        for (const [sz, q] of sc.entries()) {
          if (q > bestQty) {
            bestQty = q;
            bestSize = sz;
          }
        }
        cur.topSize = bestSize;
      }
    }
    return map;
  }, [state.customers, state.orders]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.customers
      .filter((c) => !c.deleted)
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.addresses.some((a) => a.line1.toLowerCase().includes(q) || a.city.toLowerCase().includes(q))
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state.customers, query]);

  const startNew = () => {
    const now = Date.now();
    setEditing({
      id: uid(),
      name: '',
      phone: '+504 ',
      notes: '',
      addresses: [
        {
          id: uid(),
          label: 'Casa',
          recipient: '',
          line1: '',
          city: 'La Entrada',
          department: 'Copán',
          reference: '',
          isDefault: true
        }
      ],
      createdAt: now,
      updatedAt: now
    });
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-2">
        <input
          className="input flex-1"
          placeholder="Buscar cliente por nombre, teléfono o dirección..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn-primary" onClick={startNew}>
          ➕ Nuevo Cliente
        </button>
      </div>

      {list.length === 0 ? (
        <Empty icon="👥" text="Sin clientes registrados" />
      ) : (
        <div className="space-y-3">
          {list.map((c) => {
            const st = statsByCustomer.get(c.id);
            return (
            <div key={c.id} className="card space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-extrabold text-slate-900">{c.name}</div>
                  <div className="text-sm font-semibold text-slate-600">{c.phone}</div>
                  {c.notes && <div className="mt-1 text-xs text-slate-500">{c.notes}</div>}
                </div>
                <div className="flex items-center gap-1.5">
                  <button className="btn-ghost min-h-[40px] px-3 text-xs" onClick={() => setEditing(c)}>
                    ✏️ Editar
                  </button>
                  <button
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"
                    onClick={() => setConfirmDelete(c)}
                  >
                    🗑️ Eliminar
                  </button>
                </div>
              </div>

              {st && st.orderCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-800">
                    🛍️ {st.orderCount} pedido{st.orderCount === 1 ? '' : 's'} · {money(st.totalSpent)}
                  </span>
                  {st.topSize && (
                    <span className="rounded-lg bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-900">
                      👕 Talla frecuente: {st.topSize}
                    </span>
                  )}
                  {st.balanceDue > 0 && (
                    <span className="rounded-lg bg-rose-100 px-2.5 py-1 text-xs font-extrabold text-rose-800">
                      💸 Debe {money(st.balanceDue)}
                    </span>
                  )}
                  {navigate && (
                    <button
                      type="button"
                      onClick={() => {
                        sessionStorage.setItem('cgs_orders_query', c.name);
                        navigate('pedidos');
                      }}
                      className="ml-auto rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Ver pedidos →
                    </button>
                  )}
                </div>
              )}

              {c.addresses.length > 0 && (
                <div className="space-y-2">
                  {c.addresses.map((a) => {
                    const multi = addressText(a, c);
                    return (
                      <div
                        key={a.id}
                        className="flex flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center"
                      >
                        <div className="whitespace-pre-line text-sm text-slate-700">
                          <span className="mr-2 rounded bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-900">
                            {a.label}
                          </span>
                          {multi}
                        </div>
                        <button
                          className="btn-soft shrink-0 text-sm"
                          onClick={async () => {
                            await copyText(multi);
                            toast('Dirección copiada para WhatsApp');
                          }}
                        >
                          📋 Copiar dirección
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {editing && (
        <CustomerModal
          customer={editing}
          onClose={() => setEditing(null)}
          onSave={(c) => {
            saveCustomer(c);
            setEditing(null);
            toast('Cliente guardado');
          }}
        />
      )}

      <Confirm
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Eliminar cliente"
        text={
          confirmDelete
            ? `¿Eliminar al cliente "${confirmDelete.name}"? El historial de sus pedidos anteriores se conservará.`
            : ''
        }
        confirmLabel="Sí, eliminar cliente"
        danger
        onConfirm={() => {
          if (confirmDelete) {
            deleteCustomer(confirmDelete.id);
            toast(`Cliente "${confirmDelete.name}" eliminado`);
          }
        }}
      />
    </div>
  );
}

function CustomerModal({
  customer,
  onClose,
  onSave
}: {
  customer: Customer;
  onClose: () => void;
  onSave: (c: Customer) => void;
}) {
  const [form, setForm] = useState<Customer>(customer);

  const updateAddr = (id: string, patch: Partial<Address>) => {
    setForm((f) => ({
      ...f,
      addresses: f.addresses.map((a) => (a.id === id ? { ...a, ...patch } : a))
    }));
  };

  const addAddr = () => {
    setForm((f) => ({
      ...f,
      addresses: [
        ...f.addresses,
        {
          id: uid(),
          label: `Dirección ${f.addresses.length + 1}`,
          recipient: f.name,
          line1: '',
          city: 'La Entrada',
          department: 'Copán',
          reference: '',
          isDefault: f.addresses.length === 0
        }
      ]
    }));
  };

  const removeAddr = (id: string) => {
    setForm((f) => ({
      ...f,
      addresses: f.addresses.filter((a) => a.id !== id)
    }));
  };

  const submit = () => {
    if (!form.name.trim()) return toast('Escribe el nombre del cliente', 'error');

    const rawDigits = form.phone.replace(/\D/g, '');
    const isHnPrefixed = rawDigits.startsWith('504') && rawDigits.length >= 11;
    const localDigits = isHnPrefixed ? rawDigits.slice(3) : rawDigits;
    if (localDigits.length < 8) {
      return toast('Ingresa un teléfono válido de al menos 8 dígitos (ej. 9999-9999)', 'error');
    }
    const normalizedPhone =
      isHnPrefixed || localDigits.length === 8
        ? `+504 ${localDigits}`
        : `+${rawDigits}`;

    const incompleteAddr = form.addresses.find((a) => {
      const hasLine1 = Boolean(a.line1.trim());
      const hasRef = Boolean(a.reference.trim());
      const customPlace =
        (Boolean(a.city.trim()) && a.city.trim() !== 'La Entrada') ||
        (Boolean(a.department.trim()) && a.department.trim() !== 'Copán');
      return !hasLine1 && (hasRef || customPlace);
    });
    if (incompleteAddr) {
      return toast(
        `Completa "Barrio / Colonia / Calle" en "${incompleteAddr.label || 'Dirección'}"`,
        'error'
      );
    }

    const cleanAddresses = form.addresses
      .filter((a) => a.line1.trim())
      .map((a) => ({
        ...a,
        label: a.label.trim() || 'Dirección',
        line1: a.line1.trim(),
        city: a.city.trim(),
        department: a.department.trim(),
        reference: a.reference.trim(),
        recipient: a.recipient.trim() || form.name.trim()
      }));
    if (cleanAddresses.length > 0 && !cleanAddresses.some((a) => a.isDefault)) {
      cleanAddresses[0] = { ...cleanAddresses[0], isDefault: true };
    }

    onSave({
      ...form,
      name: form.name.trim(),
      phone: normalizedPhone,
      addresses: cleanAddresses
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Cliente"
      footer={
        <button className="btn-primary w-full" onClick={submit}>
          Guardar cliente
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Nombre</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nombre completo"
          />
        </div>
        <div>
          <label className="label">Teléfono</label>
          <input
            className="input"
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+504 9999-9999"
          />
        </div>
        <div>
          <label className="label">Notas</label>
          <input
            className="input"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="section-title mb-0">Direcciones</span>
          <button type="button" className="btn-soft min-h-[40px] px-3 text-xs" onClick={addAddr}>
            + Agregar dirección
          </button>
        </div>

        {form.addresses.map((a) => (
          <div key={a.id} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <input
                className="input h-10 flex-1"
                value={a.label}
                onChange={(e) => updateAddr(a.id, { label: e.target.value })}
                placeholder="Etiqueta (Casa, Trabajo...)"
              />
              {form.addresses.length > 1 && (
                <button
                  type="button"
                  className="btn-ghost min-h-[40px] px-3 text-xs text-red-600"
                  onClick={() => removeAddr(a.id)}
                >
                  Quitar
                </button>
              )}
            </div>
            <input
              className="input"
              value={a.line1}
              onChange={(e) => updateAddr(a.id, { line1: e.target.value })}
              placeholder="Barrio / Colonia / Calle"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="input"
                value={a.city}
                onChange={(e) => updateAddr(a.id, { city: e.target.value })}
                placeholder="Ciudad"
              />
              <input
                className="input"
                value={a.department}
                onChange={(e) => updateAddr(a.id, { department: e.target.value })}
                placeholder="Departamento"
              />
            </div>
            <input
              className="input"
              value={a.reference}
              onChange={(e) => updateAddr(a.id, { reference: e.target.value })}
              placeholder="Referencia"
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}
