import { useMemo, useState } from 'react';
import type { Address, Customer } from '../lib/types';
import { useAppState } from '../lib/store';
import { addressText, deleteCustomer, saveCustomer } from '../lib/actions';
import { copyText } from '../lib/csv';
import { uid } from '../lib/ids';
import { Confirm, Empty, Modal, toast } from '../components/ui';

export default function Customers() {
  const state = useAppState();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null);

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
          {list.map((c) => (
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
          ))}
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
    const cleanAddresses = form.addresses
      .filter((a) => a.line1.trim())
      .map((a) => ({ ...a, recipient: a.recipient.trim() || form.name.trim() }));
    onSave({
      ...form,
      name: form.name.trim(),
      phone: form.phone.trim(),
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
