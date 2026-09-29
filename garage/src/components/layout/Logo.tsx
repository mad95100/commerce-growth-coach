export function Logo({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#4f46e5" />
      <path d="M32 12a20 20 0 0 0-20 20h6a14 14 0 0 1 28 0h6a20 20 0 0 0-20-20z" fill="#fff" opacity=".9" />
      <path d="M32 34 42 22" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="34" r="5" fill="#fff" />
      <rect x="14" y="44" width="36" height="6" rx="3" fill="#fff" opacity=".55" />
    </svg>
  );
}
