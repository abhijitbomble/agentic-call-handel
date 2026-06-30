"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { organizationId: string; programId: string };

export function AddArticleForm({ organizationId, programId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    source_type: "faq",
    language: "English",
    tags: "",
    content: "",
    keywords: "",
  });

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.content) {
      setError("Title and content are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const keywords = form.keywords.split(",").map((k) => k.trim()).filter(Boolean);
      const res = await fetch("/api/knowledge-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          client_program_id: programId,
          title: form.title,
          source_type: form.source_type,
          languages: [form.language],
          tags,
          content: form.content,
          keywords,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setOpen(false);
      setForm({ title: "", source_type: "faq", language: "English", tags: "", content: "", keywords: "" });
      router.refresh();
    } catch {
      setError("Could not save — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="add-record-btn" onClick={() => setOpen(true)}>
        + Add article
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Add knowledge article</span>
              <button className="modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>

            <form onSubmit={submit} className="modal-form">
              <label className="form-field">
                <span>Article title *</span>
                <input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. How to check claim status" />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <label className="form-field">
                  <span>Article type</span>
                  <select value={form.source_type} onChange={(e) => update("source_type", e.target.value)}>
                    <option value="faq">FAQ</option>
                    <option value="sop">Standard Operating Procedure</option>
                    <option value="policy">Policy Document</option>
                    <option value="script">Agent Script</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Language</span>
                  <select value={form.language} onChange={(e) => update("language", e.target.value)}>
                    <option>English</option>
                    <option>Hindi</option>
                  </select>
                </label>
              </div>

              <label className="form-field">
                <span>Article content * <span style={{ fontWeight: 400, color: "var(--muted)" }}>(what the AI will say to customers)</span></span>
                <textarea
                  value={form.content}
                  onChange={(e) => update("content", e.target.value)}
                  rows={5}
                  placeholder="Write the approved answer or procedure that the AI should use when this topic comes up..."
                />
              </label>

              <label className="form-field">
                <span>Topics / tags <span style={{ fontWeight: 400, color: "var(--muted)" }}>(comma-separated)</span></span>
                <input value={form.tags} onChange={(e) => update("tags", e.target.value)} placeholder="e.g. claims, insurance, status check" />
              </label>

              <label className="form-field">
                <span>Search keywords <span style={{ fontWeight: 400, color: "var(--muted)" }}>(comma-separated — helps AI find this article)</span></span>
                <input value={form.keywords} onChange={(e) => update("keywords", e.target.value)} placeholder="e.g. claim, status, check, update" />
              </label>

              {error && <p className="form-error">{error}</p>}

              <div className="modal-actions">
                <button type="button" className="modal-cancel-btn" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="modal-submit-btn" disabled={busy}>
                  {busy ? "Saving…" : "Add article"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
