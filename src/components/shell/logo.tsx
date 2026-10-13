export function AegisMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M16 2 4 7v8c0 7.2 5 12.9 12 15 7-2.1 12-7.8 12-15V7L16 2Z" fill="none" stroke="#56E0F0" strokeWidth="1.6" />
      <path d="M16 8 9.5 11v4.4c0 3.9 2.7 7 6.5 8.2 3.8-1.2 6.5-4.3 6.5-8.2V11L16 8Z" fill="#56E0F0" fillOpacity=".14" stroke="#6685FF" strokeWidth="1.2" />
      <circle cx="16" cy="15.5" r="2.2" fill="#56E0F0" />
    </svg>
  );
}

export function AegisWordmark() {
  return (
    <span className="flex items-center gap-2">
      <AegisMark />
      <span className="font-mono text-sm font-semibold tracking-[0.3em] text-fg">AEGIS</span>
    </span>
  );
}
