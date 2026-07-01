import { Panel } from "@/components/panel";
import { SectionHeader } from "@/components/section-header";
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

  return (
    <div className="page-stack">
      <div className="section-header-row">
        <SectionHeader
          title="Knowledge Base"
          description="Articles the AI uses to answer customer questions accurately and within policy. Upload a file or add an article to expand what the AI can respond to."
          meta={`${knowledge.length} active articles`}
        />
        {primaryOrg && primaryProgram && (
          <AddArticleForm
            organizationId={primaryOrg.id}
            programId={primaryProgram.id}
          />
        )}
      </div>
      <div className="double-grid">
        {knowledge.map((doc) => (
          <Panel
            key={doc.id}
            title={doc.title}
            subtitle={SOURCE_LABELS[doc.source_type] ?? doc.source_type.toUpperCase()}
            actions={doc.languages.map((lang) => (
              <span key={lang} className="badge badge-default">
                {lang.toUpperCase()}
              </span>
            ))}
          >
            <div className="stack-list">
              {doc.tags.length > 0 && (
                <div className="stack-row">
                  <div className="row-title-line">
                    <strong>Topics covered</strong>
                  </div>
                  <div className="kb-tags-row">
                    {doc.tags.map((tag) => (
                      <span key={tag} className="kb-tag">{tag.replaceAll("_", " ")}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="stack-row">
                <div className="row-meta">
                  <span className={`badge badge-${doc.status === "active" ? "low" : "default"}`}>
                    {doc.status === "active" ? "In use by AI" : doc.status}
                  </span>
                </div>
              </div>
            </div>
          </Panel>
        ))}
        {knowledge.length === 0 && (
          <div className="empty-state">
            <p className="empty-state-title">No articles yet</p>
            <p className="empty-state-desc">Add knowledge articles so the AI can answer customer questions accurately.</p>
          </div>
        )}
      </div>
    </div>
  );
}
