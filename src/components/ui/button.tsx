import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/client/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[4px] text-sm font-medium tracking-[0.01em] transition-[background-color,border-color,color,box-shadow] duration-200 ease-[var(--ease-cine)] disabled:cursor-not-allowed disabled:opacity-45 active:translate-y-px",
  {
    variants: {
      variant: {
        primary: "bg-cyan text-bg shadow-[0_0_24px_-10px_rgb(111_227_238/0.8)] hover:bg-ice",
        secondary: "border border-line-strong bg-elevated/60 text-fg hover:border-cyan/45 hover:bg-elevated",
        ghost: "text-muted hover:bg-elevated/70 hover:text-fg",
        danger: "border border-critical/40 bg-critical/[0.07] text-critical hover:bg-critical/15",
        success: "border border-success/45 bg-success/[0.08] text-success hover:bg-success/15",
      },
      size: { sm: "h-8 px-3 text-xs", md: "h-9 px-4", lg: "h-11 px-6 text-[15px]", icon: "h-8 w-8" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, loading, children, disabled, ...props }, ref) {
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export { buttonVariants };
