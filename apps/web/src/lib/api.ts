import { backendRequest } from "@/lib/backend-proxy";
import type {
  AnalyticsSnapshot,
  Call,
  CallTurn,
  CallbackTask,
  Customer,
  DashboardBundle,
  KnowledgeDocument,
  Organization,
  Program,
  QAReview,
  Queue,
  Ticket,
  UserProfile,
} from "@/lib/types";

const SESSION_STATE_DISPLAY: Record<string, string> = {
  disclosure_consent: "Disclosure",
  language_detected: "Listening",
  verification_if_needed: "Verifying",
  intent_captured: "Clarifying",
  answer_or_tool_action: "AI in Progress",
  live_handoff: "Handoff Requested",
  callback: "Callback Queued",
  resolved: "Resolved",
  summary: "Resolved",
  ticket: "Ticket Created",
  closed: "Completed",
};

type AuthMeResponse = {
  user: {
    id: string;
    username: string;
    full_name: string;
  };
  membership: {
    role: string;
    organization_id: string;
  };
};

function formatDuration(startedAt: string): string {
  const started = new Date(startedAt);
  const durationMs = Math.max(0, Date.now() - started.getTime());
  const mins = Math.floor(durationMs / 60000);
  const secs = Math.floor((durationMs % 60000) / 1000);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}

function augmentCalls(calls: Call[], customers: Customer[], programs: Program[]): Call[] {
  const customerByPhone = new Map(customers.map((customer) => [customer.phone_number, customer]));
  const programById = new Map(programs.map((program) => [program.id, program]));
  return calls.map((call) => {
    if (call.display_call_id) return call;
    const customer = customerByPhone.get(call.customer_phone);
    const program = programById.get(call.client_program_id);
    return {
      ...call,
      display_call_id: `C-${call.id.slice(-6).toUpperCase()}`,
      customer_name: customer?.full_name,
      program_name: program?.name,
      duration_label: formatDuration(call.started_at),
      display_status: SESSION_STATE_DISPLAY[call.session_state] ?? call.session_state,
      agent_name: null,
      agent_initials: null,
    };
  });
}

function augmentCallbacks(callbacks: CallbackTask[], customers: Customer[], programs: Program[]): CallbackTask[] {
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const programById = new Map(programs.map((program) => [program.id, program]));
  return callbacks.map((callback) => {
    if (callback.display_id) return callback;
    const customer = callback.customer_id ? customerById.get(callback.customer_id) : undefined;
    const program = programById.get(callback.client_program_id);
    return {
      ...callback,
      display_id: `CB-${callback.id.slice(-5).toUpperCase()}`,
      customer_name: customer?.full_name,
      program_name: program?.name,
      scheduled_time: callback.scheduled_for_label,
    };
  });
}

function augmentReviews(reviews: QAReview[], programs: Program[], calls: Call[]): QAReview[] {
  const programById = new Map(programs.map((program) => [program.id, program]));
  const callById = new Map(calls.map((call) => [call.id, call]));
  return reviews.map((review) => {
    if (review.display_id) return review;
    const program = programById.get(review.client_program_id);
    const relatedCall = callById.get(review.call_id);
    return {
      ...review,
      display_id: `QA-${review.id.slice(-5).toUpperCase()}`,
      program_name: program?.name,
      call_display_id: relatedCall?.display_call_id ?? `C-${review.call_id.slice(-6).toUpperCase()}`,
      date_label: formatDateLabel(review.created_at),
    };
  });
}

export async function getMe(): Promise<UserProfile> {
  const data = await backendRequest<AuthMeResponse>("/auth/me");
  return {
    id: data.user.id,
    username: data.user.username,
    full_name: data.user.full_name,
    role: data.membership.role,
    organization_id: data.membership.organization_id,
  };
}

export async function getOrganizations(): Promise<Organization[]> {
  return backendRequest<Organization[]>("/organizations");
}

export async function getPrograms(): Promise<Program[]> {
  return backendRequest<Program[]>("/programs");
}

export async function updateProgramPolicy(
  programId: string,
  payload: { policy_json: import("@/lib/types").ProgramPolicy; policy_status?: string },
): Promise<Program> {
  return backendRequest<Program>(`/programs/${programId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function getQueues(): Promise<Queue[]> {
  return backendRequest<Queue[]>("/queues");
}

export async function getCustomers(): Promise<Customer[]> {
  return backendRequest<Customer[]>("/customers");
}

export async function getCalls(): Promise<Call[]> {
  return backendRequest<Call[]>("/calls");
}

export async function getTickets(): Promise<Ticket[]> {
  return backendRequest<Ticket[]>("/tickets");
}

export async function getCallbacks(): Promise<CallbackTask[]> {
  return backendRequest<CallbackTask[]>("/callbacks");
}

export async function getReviews(): Promise<QAReview[]> {
  return backendRequest<QAReview[]>("/reviews");
}

export async function getKnowledge(): Promise<KnowledgeDocument[]> {
  return backendRequest<KnowledgeDocument[]>("/knowledge-docs");
}

export async function getAnalytics(): Promise<AnalyticsSnapshot> {
  const raw = await backendRequest<AnalyticsSnapshot>("/analytics/overview");
  return {
    ...raw,
    dispositions: (raw.dispositions ?? []).map((disposition) => ({
      ...disposition,
      color: disposition.color ?? "#94a3b8",
    })),
  };
}

export async function getCampaigns(): Promise<import("@/lib/types").Campaign[]> {
  return backendRequest<import("@/lib/types").Campaign[]>("/campaigns");
}

export async function getTranscript(callId: string): Promise<CallTurn[]> {
  return backendRequest<CallTurn[]>(`/calls/${callId}/transcript`);
}

export async function getDashboardBundle(): Promise<DashboardBundle> {
  const [organizations, programs, queues, customers, calls, tickets, callbacks, reviews, knowledge, analytics] =
    await Promise.all([
      getOrganizations(),
      getPrograms(),
      getQueues(),
      getCustomers(),
      getCalls(),
      getTickets(),
      getCallbacks(),
      getReviews(),
      getKnowledge(),
      getAnalytics(),
    ]);

  const pendingCallbacks = callbacks.filter((callback) => callback.status === "pending");
  const augmentedCalls = augmentCalls(calls, customers, programs);
  const augmentedCallbacks = augmentCallbacks(pendingCallbacks, customers, programs);
  const augmentedReviews = augmentReviews(reviews, programs, augmentedCalls);

  return {
    organizations,
    programs,
    queues,
    customers,
    calls: augmentedCalls,
    tickets,
    callbacks: augmentedCallbacks,
    reviews: augmentedReviews,
    knowledge,
    analytics,
  };
}

