import { isHttpsUrl, sourceLinkLabel } from "@/lib/ui/format";

export function SourceLink({
  url,
  className,
}: {
  url: string | null | undefined;
  className?: string;
}) {
  if (!url) return null;
  const label = sourceLinkLabel(url);
  if (!isHttpsUrl(url)) {
    return <span className={className}>{label || url}</span>;
  }
  return (
    <a
      className={className}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label || url}
    </a>
  );
}
