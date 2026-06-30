"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { organizationId: string; programId: string };

export function AddCustomerForm({ organizationId, programId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    phone_number: "",
    email: "",
    customer_code: "",
    language_preference: "English",
    vip: false,
  });

  function update(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name || !form.phone_number || !form.customer_code) {
      setError("Name, phone, and Customer ID are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          client_program_id: programId,
          ...form,
        }),
      });
      const payload = (await res.json().catch(() => null)) as { detail?: string; error?: string } | null;
      const message = payload?.detail ?? payload?.error ?? null;
      if (!res.ok) {
        if (res.status === 409) {
          setError(message ?? "Customer ID already in use. Please choose a different one.");
          return;
        }
        if (message) {
          setError(message);
          return;
        }
        throw new Error("Failed");
      }
      setOpen(false);
      setForm({ full_name: "", phone_number: "", email: "", customer_code: "", language_preference: "English", vip: false });
      router.refresh();
    } catch {
      setError("Could not save - please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="add-record-btn" onClick={() => setOpen(true)}>
        + Add customer
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Add new customer</span>
              <button className="modal-close" onClick={() => setOpen(false)}>âœ•</button>
            </div>

            <form onSubmit={submit} className="modal-form">
              <label className="form-field">
                <span>Full name *</span>
                <input value={form.full_name} onChange={(e) => update("full_name", e.target.value)} placeholder="e.g. Priya Sharma" />
              </label>
              <label className="form-field">
                <span>Phone number *</span>
                <input value={form.phone_number} onChange={(e) => update("phone_number", e.target.value)} placeholder="+91-XXXXX-XXXXX" />
              </label>
              <label className="form-field">
                <span>Customer ID *</span>
                <input value={form.customer_code} onChange={(e) => update("customer_code", e.target.value.toUpperCase())} placeholder="CUS-XXXX" />
              </label>
              <label className="form-field">
                <span>Email</span>
                <input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="email@example.com" />
              </label>
              <label className="form-field">
                <span>Preferred language</span>
                <select value={form.language_preference} onChange={(e) => update("language_preference", e.target.value)}>
                  <option>English</option>
                  <option>Hindi</option>
                </select>
              </label>
              <label className="form-field form-field-inline">
                <input type="checkbox" checked={form.vip} onChange={(e) => update("vip", e.target.checked)} />
                <span>Mark as VIP (priority routing and senior agent)</span>
              </label>

              {error && <p className="form-error">{error}</p>}

              <div className="modal-actions">
                <button type="button" className="modal-cancel-btn" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="modal-submit-btn" disabled={busy}>
                  {busy ? "Savingâ€¦" : "Add customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}


