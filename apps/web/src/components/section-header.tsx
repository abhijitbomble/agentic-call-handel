type SectionHeaderProps = {
  title: string;
  description: string;
  meta?: string;
};

export function SectionHeader({ title, description, meta }: SectionHeaderProps) {
  return (
    <header className="section-header">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {meta ? <span className="section-meta">{meta}</span> : null}
    </header>
  );
}

