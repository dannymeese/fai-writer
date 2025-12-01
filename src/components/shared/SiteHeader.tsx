"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { PencilSquareIcon, ArrowDownTrayIcon, ChevronDownIcon } from "@heroicons/react/24/solid";
import { useState, useRef, useEffect } from "react";

export default function SiteHeader() {
  const { data: session, status } = useSession();
  const isAuthenticated = status === "authenticated" && Boolean(session?.user);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  function handleNewDoc() {
    window.dispatchEvent(new Event("new-doc"));
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

  async function handleDownload(format: "docx" | "txt" | "pdf") {
    // Get active document from global event or context
    // For now, we'll dispatch an event that WriterWorkspace can listen to
    window.dispatchEvent(new CustomEvent("download-document", { detail: { format } }));
    setShowDownloadMenu(false);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-brand-stroke/60 bg-brand-background/95 px-4 py-4 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4">
        <Link href="/" className="font-display leading-tight" style={{ fontSize: '0.825rem' }}>
          <span style={{ color: "#0000ff" }}>Forgetaboutit </span>
          <span style={{ color: "#ffffff" }}>Writer</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="relative" ref={downloadMenuRef}>
            <button
              type="button"
              onClick={() => setShowDownloadMenu(!showDownloadMenu)}
              className="inline-flex items-center gap-2 rounded-full border border-brand-stroke/60 bg-brand-panel/70 px-4 py-2 text-sm font-semibold text-white transition hover:border-brand-blue hover:bg-brand-panel"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              Download
              <ChevronDownIcon className="h-4 w-4" />
            </button>
            {showDownloadMenu && (
              <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-lg border border-brand-stroke/60 bg-brand-panel shadow-lg">
                <button
                  type="button"
                  onClick={() => handleDownload("docx")}
                  className="w-full px-4 py-2 text-left text-sm text-white transition hover:bg-brand-blue/20"
                >
                  .docx
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload("txt")}
                  className="w-full px-4 py-2 text-left text-sm text-white transition hover:bg-brand-blue/20"
                >
                  .txt
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload("pdf")}
                  className="w-full px-4 py-2 text-left text-sm text-white transition hover:bg-brand-blue/20"
                >
                  .pdf
                </button>
              </div>
            )}
          </div>
          {isAuthenticated ? (
            <button
              type="button"
              onClick={handleNewDoc}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-brand-blue/90 hover:text-white"
            >
              <PencilSquareIcon className="h-4 w-4" />
              New Doc
            </button>
          ) : (
            <>
              <Link href="/sign-in" className="text-sm font-semibold text-white transition hover:text-brand-blue">
                Sign In
              </Link>
              <Link
                href="/register"
                className="rounded-full bg-brand-blue px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue/80"
              >
                Register
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

