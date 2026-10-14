/** Original AEGIS mark: an orbital ring around a faceted core. */
export function AegisMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="13.2" fill="none" stroke="#6FE3EE" strokeOpacity=".55" strokeWidth="1" />
      <ellipse cx="16" cy="16" rx="13.2" ry="4.6" fill="none" stroke="#B8DCFF" strokeOpacity=".5" strokeWidth=".8" transform="rotate(-28 16 16)" />
      <path d="M16 7.5 23 16l-7 8.5L9 16Z" fill="#6FE3EE" fillOpacity=".12" stroke="#F2EEE6" strokeOpacity=".9" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M16 7.5v17M9 16h14" stroke="#6FE3EE" strokeOpacity=".55" strokeWidth=".7" />
      <circle cx="16" cy="16" r="1.9" fill="#6FE3EE" />
    </svg>
  );
}

export function AegisWordmark({ subtitle = false }: { subtitle?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <AegisMark />
      <span className="flex flex-col leading-none">
        <span className="font-mono text-[13px] font-medium tracking-[0.42em] text-fg">AEGIS</span>
        {subtitle && <span className="mt-1 font-mono text-[9px] tracking-[0.24em] text-faint">AI COMMERCE GUARDIAN</span>}
      </span>
    </span>
  );
}
