"use client";

import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

type SiteHeaderProps = {
  onPanelToggle?: () => void;
  showPanelButton?: boolean;
};

export default function SiteHeader({ onPanelToggle, showPanelButton = false }: SiteHeaderProps = {}) {
  const { data: session, status } = useSession();
  const isAuthenticated = status === "authenticated" && Boolean(session?.user);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  
  // Check if desktop
  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  // Listen for scroll to adjust header height
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      setIsScrolled(scrollY > 0);
    };
    
    // Check initial scroll position
    handleScroll();
    
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);
  
  // Listen for sidebar state changes to update icon
  useEffect(() => {
    const handleSidebarStateChange = (event: CustomEvent) => {
      setSidebarOpen(event.detail.open);
    };
    window.addEventListener("sidebar-state-change", handleSidebarStateChange as EventListener);
    return () => {
      window.removeEventListener("sidebar-state-change", handleSidebarStateChange as EventListener);
    };
  }, []);

  // Listen for settings popup state changes to darken header
  useEffect(() => {
    const handleSettingsStateChange = (event: CustomEvent) => {
      setSettingsOpen(event.detail.open);
    };
    window.addEventListener("settings-state-change", handleSettingsStateChange as EventListener);
    return () => {
      window.removeEventListener("settings-state-change", handleSettingsStateChange as EventListener);
    };
  }, []);

  function handleNewDoc() {
    window.dispatchEvent(new Event("new-doc"));
  }

  function handlePanelToggle() {
    if (onPanelToggle) {
      onPanelToggle();
    } else {
      // Update local state immediately so header transitions at the same time as content
      setSidebarOpen((prev) => !prev);
      window.dispatchEvent(new Event("toggle-sidebar"));
    }
  }

  // Close download menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(event.target as Node)) {
        setShowDownloadMenu(false);
      }
    }
    if (showDownloadMenu) {
      window.document.addEventListener("mousedown", handleClickOutside);
      return () => window.document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showDownloadMenu]);

  async function handleDownload(format: "docx" | "txt" | "pdf" | "md") {
    // Get active document from global event or context
    // For now, we'll dispatch an event that WriterWorkspace can listen to
    window.dispatchEvent(new CustomEvent("download-document", { detail: { format } }));
    // Menu will be closed by DocumentEditor after handling the download
  }
  
  // Listen for close menu event
  useEffect(() => {
    const handleCloseMenu = () => {
      setShowDownloadMenu(false);
    };
    window.addEventListener("close-download-menu", handleCloseMenu);
    return () => {
      window.removeEventListener("close-download-menu", handleCloseMenu);
    };
  }, []);

  const headerHeight = isScrolled ? '60px' : '100px';
  const wordmarkHeight = isScrolled ? 24 : 34;

  return (
    <header
      data-site-header
      className={cn(
        "sticky top-0 border-b border-brand-stroke/60 bg-brand-background/60 backdrop-blur-[10px] transition-all duration-300",
        sidebarOpen && isAuthenticated && isDesktop ? "lg:ml-[320px] pl-0 pr-5" : "px-5",
        settingsOpen ? "brightness-50" : undefined
      )}
      style={{ height: headerHeight, zIndex: 1200 }}
    >
      <div className="mx-auto w-full h-full relative flex items-center transition-all duration-300 ease-in-out" style={{ maxWidth: '1720px' }}>
        {isAuthenticated && (
          <button
            type="button"
            onClick={handlePanelToggle}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center border border-brand-stroke/60 bg-transparent text-white hover:bg-brand-panel/50 transition-colors",
              sidebarOpen && isDesktop
                ? "left-0 rounded-r-full border-l-0"
                : "left-5 rounded-full"
            )}
            aria-label="Toggle panel"
          >
            <span className="material-symbols-outlined" style={{ fontSize: sidebarOpen ? '30px' : '23px' }}>
              {sidebarOpen ? "chevron_left" : "menu"}
            </span>
          </button>
        )}
        <Link href="/" className="absolute left-1/2 top-1/2 -translate-x-1/2 transition-all duration-150 ease-in-out" style={{ transform: 'translate(-50%, calc(-50% + 1px))' }}>
          <Image 
            src="/wordmark-svg-fai-writer.svg" 
            alt="Forgetaboutit Writer - AI Writing Assistant and Content Creation Tool" 
            height={wordmarkHeight}
            width={200} // Will maintain aspect ratio
            className="h-auto transition-all duration-150 ease-in-out"
            style={{ height: `${wordmarkHeight}px`, width: 'auto' }}
            priority
            unoptimized
          />
        </Link>
        {isAuthenticated ? (
          <button
            type="button"
            onClick={handleNewDoc}
            className="absolute right-5 top-1/2 -translate-y-1/2 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-brand-blue/90 hover:text-white"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '21px' }}>edit_square</span>
            New Doc
          </button>
        ) : (
          <div className="absolute right-5 top-1/2 -translate-y-1/2 flex items-center gap-3">
            <Link href="/sign-in" className="text-sm font-semibold text-white transition hover:text-brand-blue">
              Sign In
            </Link>
            <Link
              href="/register"
              className="rounded-full bg-brand-blue px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue/80"
            >
              Register
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

