import { SectionHeader } from "@/components/section-header";
import { ReviewCard } from "@/components/review-card";
import { getPrograms, getReviews } from "@/lib/api";

export default async function ReviewsPage() {
  const [reviews, programs] = await Promise.all([getReviews(), getPrograms()]);
  const programById = Object.fromEntries(programs.map((p) => [p.id, p.name]));
  const pending = reviews.filter((r) => r.status === "pending").length;

  return (
    <div className="page-stack">
      <SectionHeader
        title="QA review"
        description="Score calls, add coaching notes, and flag quality issues for program owners."
        meta={`${pending} pending · ${reviews.length} total`}
      />
      <div className="double-grid">
        {reviews.map((review) => (
          <ReviewCard
            key={review.id}
            review={review}
            programName={review.program_name ?? programById[review.client_program_id] ?? "—"}
          />
        ))}
      </div>
    </div>
  );
}
