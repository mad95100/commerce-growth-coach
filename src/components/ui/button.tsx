import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
  LE BOUTON.

  DEUX CHOSES ONT CHANGÉ, ET LES DEUX SE VOIENT AU DOIGT PLUS QU'À L'ŒIL.

  1. LA HAUTEUR. 36 px (`h-9`) sur mobile, c'est sous la cible tactile de 44 px
     recommandée partout, et c'est ce que le marchand utilise. Les tailles
     passent à 44 px par défaut et 40 px en `sm` — assez pour le pouce, sans
     alourdir une barre d'outils.

  2. LE POIDS DU TEXTE. `font-medium` sur un fond coloré rend un libellé mou.
     `font-semibold` tient la comparaison avec le reste de l'interface.

  Le focus passe d'un anneau de 1 px à 2 px avec décalage : à 1 px sur fond
  clair, il était invisible — donc inexistant pour qui navigue au clavier.
*/
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-card hover:bg-secondary",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "hover:bg-secondary",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 py-2",
        sm: "h-10 rounded-lg px-3.5 text-[13px]",
        lg: "h-12 rounded-lg px-7 text-[15px]",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
