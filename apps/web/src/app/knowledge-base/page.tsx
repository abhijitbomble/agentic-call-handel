import { Panel } from "@/components/panel";
import { SectionHeader } from "@/components/section-header";
import { StatCard } from "@/components/stat-card";
import { AddArticleForm } from "@/components/add-article-form";
import { getKnowledge, getDashboardBundle } from "@/lib/api";

const SOURCE_LABELS: Record<string, string> = {
  faq: "FAQ",
  sop: "Standard Operating Procedure",
  policy: "Policy Document",
  script: "Agent Script",
  guide: "Reference Guide",
};

export default async function KnowledgeBasePage() {
  const [knowledge, bundle] = await Promise.all([getKnowledge(), getDashboardBundle()]);
  const primaryOrg = bundle.organizations[0];
  const primaryProgram = bundle.programs[0];
  const programById = new Map(bundle.programs.map((program) => [program.id, program.name]));
  const activeDocs = knowledge.filter((doc) => doc.status === "active");
  const sourceCounts = knowledge.reduce<Record<string, number>>((acc, doc) => {
    acc[doc.source_type] = (acc[doc.source_type] ?? 0) + 1;
    return acc;
  }, {});
  const uniqueLanguages = Array.from(new Set(knowledge.flatMap((doc) => doc.languages))).sort();
  const programCounts = knowledge.reduce<Record<string, number>>((acc, doc) => {
    const name = programById.get(doc.client_program_id) ?? doc.client_program_id;
    acc[name] = (acc[name] ?? 0) + 1;
    return acc;
  }, {});
  const topProgram = Object.entries(programCounts).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="page-stack">
      <div className="section-header-row">
        <SectionHeader
          title="Knowledge Base"
          description="This is the KB control plane for the agent runtime. Upload approved files, convert them into searchable knowledge, and control which programs can rely on them."
          meta={`${knowledge.length} documents · ${activeDocs.length} active`}
        />
        {primaryOrg && primaryProgram && (
          <AddArticleForm
            organizationId={primaryOrg.id}
            programId={primaryProgram.id}
          />
        )}
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <StatCard label="Documents" value={knowledge.length} detail="All knowledge entries in this org" icon="queue" tone="default" />
          <StatCard label="Active docs" value={activeDocs.length} detail="Available to the live agent" icon="check" tone="success" />
          <StatCard label="Languages" value={uniqueLanguages.length || 0} detail={uniqueLanguages.join(" / ") || "No languages yet"} icon="star" tone="accent" />
          <StatCard label="Top program" value={topProgram?.[0] ?? "—"} detail={topProgram ? `${topProgram[1]} docs linked` : "No program-linked docs yet"} icon="phone" tone="info" />
        </div>

        <div className="double-grid" style={{ alignItems: "start" }}>
          <div style={{ display: "grid", gap: 14 }}>
            <Panel
              title="Document library"
              subtitle="Approved content the runtime can retrieve for a call."
              actions={
                <div className="row-meta" style={{ gap: 10 }}>
                  {Object.entries(sourceCounts).slice(0, 3).map(([source, count]) => (
                    <span key={source} className="badge badge-default">
                      {SOURCE_LABELS[source] ?? source.toUpperCase()} · {count}
                    </span>
                  ))}
                </div>
              }
            >
              <div style={{ padding: 16, display: "grid", gap: 12 }}>
                {knowledge.length > 0 ? (
                  knowledge.map((doc) => (
                    <div
                      key={doc.id}
                      style={{
                        padding: 14,
                        borderRadius: 16,
                        border: "1px solid rgba(28,42,43,0.10)",
                        background: "white",
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <strong style={{ fontSize: 14 }}>{doc.title}</strong>
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>
                            {SOURCE_LABELS[doc.source_type] ?? doc.source_type.toUpperCase()} · {programById.get(doc.client_program_id) ?? doc.client_program_id}
                          </span>
                        </div>
                        <span className={`badge badge-${doc.status === "active" ? "low" : "default"}`}>
                          {doc.status === "active" ? "In use by AI" : doc.status}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {doc.languages.map((lang) => (
                          <span key={lang} className="badge badge-default">
                            {lang.toUpperCase()}
                          </span>
                        ))}
                        {doc.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="kb-tag">
                            {tag.replaceAll("_", " ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <p className="empty-state-title">No articles yet</p>
                    <p className="empty-state-desc">Add knowledge articles so the AI can answer customer questions accurately.</p>
                  </div>
                )}
              </div>
            </Panel>
          </div>

          <div style={{ display: "grid", gap: 14 }}>
            <Panel
              title="KB operating rules"
              subtitle="How the agent is allowed to use documents during a call."
            >
              <div className="stack-list">
                <div className="stack-row">
                  <strong>Approved only</strong>
                  <span className="row-meta">The runtime should only search documents marked for this org/program.</span>
                </div>
                <div className="stack-row">
                  <strong>Program bound</strong>
                  <span className="row-meta">Knowledge is attached to a client program, not exposed globally.</span>
                </div>
                <div className="stack-row">
                  <strong>Converted source</strong>
                  <span className="row-meta">Files are ingested and chunked before the agent can use them in live calls.</span>
                </div>
                <div className="stack-row">
                  <strong>Human-safe fallback</strong>
                  <span className="row-meta">If the KB answer is weak, the agent should escalate rather than guess.</span>
                </div>
              </div>
            </Panel>

            <Panel
              title="Upload pipeline"
              subtitle="Use the button below to ingest a file or create a manual article."
            >
              <div style={{ padding: 16, display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div className="row-title-line">
                    <strong>Supported files</strong>
                    <span className="badge badge-default">PDF · DOCX · TXT · MD · CSV · JSON</span>
                  </div>
                  <div className="row-meta" style={{ lineHeight: 1.5 }}>
                    Upload approved client content, convert it into KB chunks, and attach it to the selected program for retrieval.
                  </div>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div className="row-title-line">
                    <strong>Best practice</strong>
                  </div>
                  <div className="row-meta" style={{ lineHeight: 1.5 }}>
                    Use one file per policy or procedure, add tags that match caller intents, and keep the article title clear for admins.
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
