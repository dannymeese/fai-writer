import Link from "next/link";
import Image from "next/image";

const LOGO_SRC = "https://forgetaboutit.ai/wp-content/uploads/2025/06/FAIwordmark-1.png";

const navLinks = [
  { label: "Contact", href: "https://forgetaboutit.ai/#contact" },
  { label: "Why Forgetaboutit?", href: "https://forgetaboutit.ai/#why-forgetaboutit" },
  { label: "About", href: "https://forgetaboutit.ai/#about" },
  { label: "FAQ", href: "https://forgetaboutit.ai/#FAQ" },
  { label: "Terms of Use", href: "https://forgetaboutit.ai/privacy-policy/" },
  { label: "Privacy Policy", href: "https://forgetaboutit.ai/privacy-policy/?Privacy" },
  { label: "Cookies Policy", href: "https://forgetaboutit.ai/privacy-policy/?cookies" }
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-brand-stroke/60 bg-brand-background px-4 py-10 text-brand-text">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 lg:flex-row lg:justify-between">
        <div className="space-y-4 lg:max-w-md">
          <Link href="https://forgetaboutit.ai" target="_blank" rel="noreferrer" className="inline-flex">
            <Image src={LOGO_SRC} alt="Forgetaboutit" width={200} height={48} className="h-10 w-auto" />
          </Link>
          <p className="text-sm text-brand-muted">
            Make your work forgettable, and your results impossible to forget.
          </p>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-muted">Stay up to date with AI and automation.</h3>
            <form
              className="space-y-3"
              action="https://forgetaboutit.ai/#contact"
              target="_blank"
              rel="noreferrer"
            >
              <input
                type="email"
                placeholder="Email"
                className="w-full rounded-2xl border border-brand-stroke/70 bg-brand-ink px-4 py-3 text-sm text-brand-text placeholder:text-brand-muted focus:border-brand-blue focus:outline-none"
              />
              <label className="flex items-center gap-2 text-xs text-brand-muted">
                <input type="checkbox" className="h-4 w-4 rounded border-brand-stroke/70 bg-transparent" />
                I accept the privacy policy
              </label>
              <button className="w-full rounded-full bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blueHover">
                Subscribe
              </button>
            </form>
          </div>
        </div>
        <div className="space-y-4 lg:text-right">
          <ul className="space-y-2 text-sm text-brand-muted">
            {navLinks.map((link) => (
              <li key={link.label}>
                <Link href={link.href} target="_blank" rel="noreferrer" className="hover:text-brand-blue">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-brand-muted">©2025 FORGETABOUTIT.AI. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

