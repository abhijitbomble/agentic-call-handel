import { Panel } from "@/components/panel";
import { SectionHeader } from "@/components/section-header";
import { getDashboardBundle } from "@/lib/api";

const INTENT_LABELS: Record<string, string> = {
  case_status: "Claim status inquiries",
  complaint_registration: "Complaint filing",
  policy_query: "Policy questions",
  billing_dispute: "Billing disputes",
  agent_request: "Live agent requests",
  escalation: "Escalations",
  unknown_needs_clarification: "Unclear requests",
};

const IDENTIFIER_LABELS: Record<string, string> = {
  customer_code: "Customer ID (e.g. CUS-1001)",
  last4_phone: "Last 4 digits of phone number",
  dob: "Date of birth",
  account_number: "Account number",
};

const TRIGGER_LABELS: Record<string, string> = {
  agent_request: "Customer explicitly asks for an agent",
  escalation: "Call is escalated",
  max_retries: "AI reaches retry limit",
  low_confidence: "AI confidence is too low",
};

function labelIntent(intent: string) {
  return INTENT_LABELS[intent] ?? intent.replaceAll("_", " ");
}
function labelIdentifier(id: string) {
  return IDENTIFIER_LABELS[id] ?? id.replaceAll("_", " ");
}
function labelTrigger(trigger: string) {
  return TRIGGER_LABELS[trigger] ?? trigger.replaceAll("_", " ");
}

export default async function ProgramsPage() {
  const data = await getDashboardBundle();

  return (
    <div className="page-stack">
      <SectionHeader
        title="Client Programs"
        description="Each program defines which calls require identity verification, when to transfer to a live agent, and what the AI is allowed to say."
        meta={`${data.programs.length} programs`}
      />
      <div className="double-grid">
        {data.programs.map((program) => {
          const queues = data.queues.filter((q) => q.client_program_id === program.id);
          const verifyFor = program.verification_policy.required_for ?? [];
          const identifiers = program.verification_policy.allowed_identifiers ?? [];
          const liveTriggers = program.handoff_policy.live_on ?? [];
          const threshold = program.handoff_policy.low_confidence_threshold ?? 0.7;
          const thresholdPct = Math.round(threshold * 100);

          return (
            <Panel
              key={program.id}
              title={program.name}
              subtitle={program.description}
              actions={program.languages.map((lang) => (
                <span key={lang} className="badge badge-default">
                  {lang.toUpperCase()}
                </span>
              ))}
            >
              <div className="stack-list">

                {/* Identity verification */}
                <div className="stack-row">
                  <div className="row-title-line">
                    <strong>Identity verification</strong>
                    <span className={`badge badge-${verifyFor.length > 0 ? "high" : "default"}`}>
                      {verifyFor.length > 0 ? "Required" : "Not required"}
                    </span>
                  </div>
                  {verifyFor.length > 0 && (
                    <div className="row-meta">
                      <span>Verify before: {verifyFor.map(labelIntent).join(", ")}</span>
                      <span>Customer can prove identity using: {identifiers.map(labelIdentifier).join(" or ")}</span>
                    </div>
                  )}
                </div>

                {/* Live agent handoff */}
                <div className="stack-row">
                  <div className="row-title-line">
                    <strong>Live agent handoff</strong>
                    <span className={`badge badge-${program.handoff_policy.callback_on_unavailable ? "default" : "warning"}`}>
                      {program.handoff_policy.callback_on_unavailable ? "Callback if no agent available" : "Live agent only"}
                    </span>
                  </div>
                  <div className="row-meta">
                    {liveTriggers.length > 0 && (
                      <span>Transfer when: {liveTriggers.map(labelTrigger).join(", ")}</span>
                    )}
                    <span>AI asks for human help when confidence falls below {thresholdPct}%</span>
                  </div>
                </div>

                {/* Disclosure scripts */}
                <div className="stack-row">
                  <div className="row-title-line">
                    <strong>AI introduction scripts</strong>
                    <span className="badge badge-default">Read at call start</span>
                  </div>
                  <div className="program-disclosure-block">
                    <span className="program-disclosure-lang">English</span>
                    <p className="program-disclosure-text">{program.disclosure_template_en}</p>
                  </div>
                  {program.disclosure_template_hi && (
                    <div className="program-disclosure-block">
                      <span className="program-disclosure-lang">Hindi</span>
                      <p className="program-disclosure-text">{program.disclosure_template_hi}</p>
                    </div>
                  )}
                </div>

                {/* Queue hours */}
                {queues.map((queue) => (
                  <div key={queue.id} className="stack-row">
                    <div className="row-title-line">
                      <strong>{queue.name}</strong>
                      <span className="badge badge-default">{queue.timezone}</span>
                    </div>
                    <div className="row-meta">
                      <span>Office hours: {queue.business_hours_start} – {queue.business_hours_end}</span>
                      <span>{queue.live_handoff_enabled ? "Live takeover enabled" : "Live takeover disabled"}</span>
                    </div>
                  </div>
                ))}

              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
