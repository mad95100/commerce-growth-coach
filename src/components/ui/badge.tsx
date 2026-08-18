import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
  LA PASTILLE.

  Sur fond clair, une pastille en couleur PLEINE (fond primaire, texte blanc)
  attire autant l'œil qu'un bouton — alors qu'elle n'est pas cliquable. Une
  liste de constats en devenait un damier de rectangles colorés où le regard ne
  savait plus où se poser.

  Les variantes passent donc en TEINTE : fond très pâle, texte foncé de la même
  famille. La sévérité reste immédiatement lisible, sans concurrencer l'action.
*/
const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-accent text-accent-foreground",
        secondary: "border-transparent bg-secondary text-muted-foreground",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        outline: "border-border text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
