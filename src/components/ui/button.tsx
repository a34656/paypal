import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/client/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2",
  {
    variants: {
      variant: {
        primary: "bg-cyan text-bg hover:bg-cyan/90",
        secondary: "border border-line-strong bg-elevated text-fg hover:border-cyan/50 hover:bg-elevated/80",
        ghost: "text-muted hover:bg-elevated hover:text-fg",
        danger: "border border-critical/40 bg-critical/10 text-critical hover:bg-critical/20",
        success: "border border-success/40 bg-success/10 text-success hover:bg-success/20",
      },
      size: { sm: "h-8 px-3 text-xs", md: "h-9 px-4", lg: "h-11 px-6 text-base", icon: "h-8 w-8" },
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
