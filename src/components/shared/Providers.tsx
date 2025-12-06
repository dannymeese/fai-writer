"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { ReactNode, useEffect } from "react";

type ProvidersProps = {
  children: ReactNode;
  session: Session | null;
};

export default function Providers({ children, session }: ProvidersProps) {
  useEffect(() => {
    // Wait for Material Symbols fonts to load before showing icons
    const showIcons = () => {
      document.documentElement.classList.add("fonts-loaded");
    };

    // Use Font Loading API if available
    if (typeof document !== "undefined" && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(() => {
        // Double-check that Material Symbols fonts are actually loaded
        const checkFonts = () => {
          const fonts = (document as any).fonts;
          if (fonts?.check) {
            const fontsLoaded = [
              fonts.check('16px "Material Symbols Outlined"'),
              fonts.check('16px "Material Symbols Sharp"'),
              fonts.check('16px "Material Symbols Rounded"')
            ].some(Boolean);
            
            if (fontsLoaded) {
              showIcons();
            } else {
              // Retry after a short delay
              setTimeout(checkFonts, 100);
            }
          } else {
            // Font Loading API available but check() not supported, show icons anyway
            showIcons();
          }
        };
        
        // Small delay to ensure fonts are processed
        setTimeout(checkFonts, 50);
      });
    } else {
      // Fallback: show icons after fonts should be loaded
      setTimeout(showIcons, 1000);
    }
  }, []);

  return <SessionProvider session={session}>{children}</SessionProvider>;
}

