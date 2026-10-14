/** Static AEGIS Core for no-WebGL / reduced-motion devices. CSS only; animation is disabled by reduced motion. */
export function CoreFallback({ className = "" }: { className?: string }) {
  return (
    <div className={`relative flex items-center justify-center ${className}`} aria-hidden>
      <div className="absolute h-[62%] aspect-square rounded-full bg-[radial-gradient(circle,rgb(111_227_238/0.18),transparent_65%)]" />
      <div className="absolute h-[54%] aspect-square rounded-full border border-cyan/30" />
      <div className="absolute h-[54%] aspect-square rounded-full border border-ice/20 [transform:rotateX(70deg)_rotateZ(-20deg)]" />
      <div className="absolute h-[66%] aspect-square rounded-full border border-purple/15 [transform:rotateX(62deg)_rotateZ(35deg)]" />
      <svg viewBox="0 0 100 100" className="relative h-[30%] aspect-square">
        <path d="M50 8 86 50 50 92 14 50Z" fill="rgb(111 227 238 / 0.08)" stroke="rgb(242 238 230 / 0.7)" strokeWidth="0.8" />
        <path d="M50 8v84M14 50h72M50 8 30 50l20 42 20-42Z" fill="none" stroke="rgb(184 220 255 / 0.35)" strokeWidth="0.5" />
        <circle cx="50" cy="50" r="4" fill="#6FE3EE" />
      </svg>
    </div>
  );
}
