"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { PencilSquareIcon, ArrowDownTrayIcon } from "@heroicons/react/24/solid";
import { useState, useRef, useEffect } from "react";

type SiteHeaderProps = {
  onPanelToggle?: () => void;
  showPanelButton?: boolean;
};

export default function SiteHeader({ onPanelToggle, showPanelButton = false }: SiteHeaderProps = {}) {
  const { data: session, status } = useSession();
  const isAuthenticated = status === "authenticated" && Boolean(session?.user);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  
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

  function handleNewDoc() {
    window.dispatchEvent(new Event("new-doc"));
  }

  function handlePanelToggle() {
    if (onPanelToggle) {
      onPanelToggle();
    } else {
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

  return (
    <header className="sticky top-0 z-40 border-b border-brand-stroke/60 bg-brand-background/95 px-5 backdrop-blur-xl" style={{ height: '60px' }}>
      <div className="mx-auto w-full h-full relative flex items-center" style={{ maxWidth: '1720px' }}>
        {isAuthenticated && (
          <button
            type="button"
            onClick={handlePanelToggle}
            className="absolute left-5 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-brand-stroke/60 bg-transparent text-white hover:bg-brand-panel/50 transition-colors"
            aria-label="Toggle panel"
          >
            <span className="material-symbols-outlined text-xl">
              {sidebarOpen ? "left_panel_close" : "left_panel_open"}
            </span>
          </button>
        )}
        <Link href="/" className="font-display leading-none flex items-center absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ fontSize: '24px', lineHeight: '1', whiteSpace: 'pre' }}>
          <span style={{ color: "#0000ff" }}>Forgetaboutit</span>
          <span style={{ color: "#ffffff" }}> Writer</span>
        </Link>
        {isAuthenticated ? (
          <button
            type="button"
            onClick={handleNewDoc}
            className="absolute right-5 top-1/2 -translate-y-1/2 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-brand-blue/90 hover:text-white"
          >
            <PencilSquareIcon className="h-4 w-4" />
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

