import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "attack" | "ghost" | "outline";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

/**
 * Source-owned button primitive with the same data-slot surface used by shadcn.
 * Visual tokens intentionally live in app/globals.css so the product theme owns
 * every color, radius, and interaction state.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    size = "default",
    type = "button",
    variant = "secondary",
    ...props
  },
  ref,
) {
  return (
    <button
      className={classes("button", "ui-button", className)}
      data-size={size}
      data-slot="button"
      data-variant={variant}
      ref={ref}
      type={type}
      {...props}
    />
  );
});
