 "use client";
 
 import { Dialog, Transition } from "@headlessui/react";
 import { Fragment, useState, useEffect } from "react";
import { MinusSmallIcon } from "@heroicons/react/24/outline";
 import { ComposerSettingsInput, marketTiers } from "@/lib/validators";
 import { cn } from "@/lib/utils";
 import { ErrorPopup, type ErrorDetails } from "@/components/shared/ErrorPopup";
 
type SettingsSheetProps = {
  open: boolean;
  onClose: () => void;
  settings: ComposerSettingsInput;
  onChange: (next: ComposerSettingsInput) => void;
  anchorRect: DOMRect | null;
  onBrandUpdate?: (summary: string | null, name?: string | null) => void;
  initialBrandDefined?: boolean;
};
 
const marketLabels = {
  MASS: "Mass",
  PREMIUM: "Premium",
  LUXURY: "Luxury",
  UHNW: "UHNW"
} as const;

const marketDollarSigns = {
  MASS: "$",
  PREMIUM: "$$",
  LUXURY: "$$$",
  UHNW: "$$$$$"
} as const;

const marketExamples = {
  MASS: "Make every day feel this good.",
  PREMIUM: "Crafted to elevate your routine.",
  LUXURY: "Because indulgence should be effortless.",
  UHNW: "Reserved for the few who rewrite the rules."
} as const;
 
export default function SettingsSheet({
  open,
  onClose,
  settings,
  onChange,
  anchorRect,
  onBrandUpdate,
  initialBrandDefined = false
}: SettingsSheetProps) {
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [brandInput, setBrandInput] = useState("");
  const [brandName, setBrandName] = useState("");
  const [brandProcessing, setBrandProcessing] = useState(false);
  const [hasBrand, setHasBrand] = useState(initialBrandDefined);
  const [clearingBrand, setClearingBrand] = useState(false);
  const [editingBrandName, setEditingBrandName] = useState(false);
  const [currentBrandName, setCurrentBrandName] = useState("");
  const [currentBrandInfo, setCurrentBrandInfo] = useState("");
  const [showESLTooltip, setShowESLTooltip] = useState(false);
  const [eslTooltipTimeout, setEslTooltipTimeout] = useState<NodeJS.Timeout | null>(null);
  const [hoveredGradeLevel, setHoveredGradeLevel] = useState<string | null>(null);
  const [gradeLevelTooltipTimeout, setGradeLevelTooltipTimeout] = useState<NodeJS.Timeout | null>(null);
  const [hoveredMarketTier, setHoveredMarketTier] = useState<string | null>(null);
  const [marketTierTooltipTimeout, setMarketTierTooltipTimeout] = useState<NodeJS.Timeout | null>(null);
  const [errorPopup, setErrorPopup] = useState<ErrorDetails | null>(null);

  useEffect(() => {
    setHasBrand(initialBrandDefined);
  }, [initialBrandDefined]);

  // Check if brand is defined on mount and when modal opens
  useEffect(() => {
    async function checkBrand() {
      try {
        const response = await fetch("/api/brand");
        if (response.ok) {
          const data = await response.json();
          const summary = data.brandInfo ?? null;
          const name = data.brandName ?? null;
          setHasBrand(!!summary);
          setCurrentBrandName(name || "");
          setCurrentBrandInfo(summary || "");
          onBrandUpdate?.(summary, name);
        }
      } catch (error) {
        console.error("Failed to check brand info", error);
      }
    }
    if (open) {
      checkBrand();
    }
  }, [open, onBrandUpdate]);

  async function handleDefineBrand() {
    console.log("handleDefineBrand called", { 
      brandInput: brandInput, 
      brandInputLength: brandInput?.length,
      brandInputTrimmed: brandInput?.trim(),
      hasContent: !!brandInput?.trim()
    });
    
    if (!brandInput.trim()) {
      console.warn("Brand input is empty, returning early");
      return;
    }
    
    console.log("Starting brand save process...");
    setBrandProcessing(true);
    try {
      const requestBody = { 
        brandName: brandName?.trim() || undefined,
        brandInfo: brandInput.trim() 
      };
      
      console.log("Sending brand save request:", { 
        hasBrandName: !!requestBody.brandName,
        hasBrandInfo: !!requestBody.brandInfo,
        brandInfoLength: requestBody.brandInfo?.length
      });
      
      const response = await fetch("/api/brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      
      console.log("Response received:", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      let data: any = null;
      let responseText = "";
      
      try {
        responseText = await response.text();
        console.log("Response text length:", responseText.length);
        console.log("Response text preview:", responseText.substring(0, 200));
        
        if (responseText) {
          try {
            data = JSON.parse(responseText);
            console.log("Parsed JSON data:", data);
          } catch (parseError) {
            console.error("Failed to parse JSON:", parseError);
            // Not JSON, use as text
            data = { error: responseText };
          }
        } else {
          // Empty response
          console.warn("Empty response received");
          data = {};
        }
      } catch (textError) {
        console.error("Failed to read response", textError);
        responseText = "Unable to read response";
        data = { error: "Unable to read response from server" };
      }
      
      // Check if response is successful and has the expected data
      if (response.ok && !data?.error && (data?.brandInfo || data?.brandName || data?.success)) {
        console.log("Brand save successful:", { 
          brandName: data.brandName, 
          hasBrandInfo: !!data.brandInfo 
        });
        const summary = data.brandInfo ?? null;
        const name = data.brandName ?? null;
        setBrandInput("");
        setBrandName("");
        setBrandModalOpen(false);
        setHasBrand(!!summary);
        setCurrentBrandName(name || "");
        setCurrentBrandInfo(summary || "");
        onBrandUpdate?.(summary, name);
      } else {
        // Handle Zod validation errors or other errors
        let errorMessage = "Failed to save brand";
        let errorDetails: string | unknown = null;
        
        // Log full response for debugging - log each piece separately to avoid serialization issues
        console.error("=== BRAND SAVE ERROR DEBUG ===");
        console.error("Response Status:", response.status);
        console.error("Response StatusText:", response.statusText);
        console.error("Response OK:", response.ok);
        console.error("Response Text:", responseText);
        console.error("Response Text Length:", responseText?.length || 0);
        console.error("Parsed Data:", data);
        console.error("Data Type:", typeof data);
        console.error("Data is null?", data === null);
        console.error("Data is undefined?", data === undefined);
        console.error("Has Error:", !!data?.error);
        console.error("Error Type:", typeof data?.error);
        console.error("Data Keys:", data ? Object.keys(data) : "no data");
        console.error("=============================");
        
        // Create debug info object for error popup
        const debugInfo = {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          data: data,
          responseText: responseText,
          responseTextLength: responseText?.length || 0,
          hasError: !!data?.error,
          errorType: typeof data?.error,
          dataKeys: data ? Object.keys(data) : []
        };
        
        // Try to stringify for logging
        try {
          console.error("Debug Info JSON:", JSON.stringify(debugInfo, null, 2));
        } catch (stringifyError) {
          console.error("Could not stringify debug info:", stringifyError);
          console.error("Debug Info (raw):", debugInfo);
        }
        
        if (data?.error) {
          if (typeof data.error === "string") {
            errorMessage = data.error;
          } else if (data.error.formErrors && Array.isArray(data.error.formErrors) && data.error.formErrors.length > 0) {
            errorMessage = data.error.formErrors.join(", ");
            errorDetails = data.error;
          } else if (data.error.fieldErrors) {
            const fieldMessages = Object.entries(data.error.fieldErrors)
              .flatMap(([field, errors]) => 
                Array.isArray(errors) ? errors.map(err => `${field}: ${err}`) : []
              );
            errorMessage = fieldMessages.length > 0 ? fieldMessages.join(", ") : "Validation failed";
            errorDetails = data.error;
          } else if (data.error.details) {
            errorMessage = typeof data.error.details === "string" ? data.error.details : "Error details available";
            errorDetails = data.error.details;
          } else {
            // Error is an object but doesn't match expected structure
            errorMessage = "An error occurred while saving the brand";
            errorDetails = data.error;
          }
        } else if (!response.ok) {
          // Response not OK but no error in data
          if (response.status === 500) {
            errorMessage = "Server error occurred";
          } else if (response.status === 400) {
            errorMessage = "Invalid request";
          } else if (response.status === 401) {
            errorMessage = "Authentication required";
          } else if (response.status === 403) {
            errorMessage = "Permission denied";
          } else {
            errorMessage = `Request failed with status ${response.status}`;
          }
          errorDetails = responseText || data || `HTTP ${response.status}: ${response.statusText}`;
        } else if (responseText) {
          errorMessage = responseText;
          errorDetails = responseText;
        } else if (data && Object.keys(data).length > 0) {
          // Data exists but doesn't have expected structure
          errorMessage = "Unexpected response format";
          errorDetails = data;
        }
        
        setErrorPopup({
          message: errorMessage,
          status: response.status,
          statusText: response.statusText,
          details: errorDetails,
          fullError: { 
            response: { 
              status: response.status, 
              statusText: response.statusText,
              ok: response.ok
            }, 
            data, 
            responseText,
            debugInfo
          }
        });
      }
    } catch (error) {
      console.error("Failed to save brand info - Exception:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      setErrorPopup({
        message: `Network or unexpected error: ${errorMessage}`,
        details: errorStack || errorMessage,
        fullError: {
          error,
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          message: errorMessage,
          stack: errorStack
        }
      });
    } finally {
      setBrandProcessing(false);
    }
  }
  
  async function handleUpdateBrandName() {
    if (editingBrandName) {
      const originalName = brandName || "";
      if (currentBrandName.trim() !== originalName.trim()) {
        try {
          const response = await fetch("/api/brand", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              brandName: currentBrandName.trim() || null,
              brandInfo: currentBrandInfo 
            })
          });
          
          let data: any = null;
          let responseText = "";
          
          try {
            responseText = await response.text();
            if (responseText) {
              try {
                data = JSON.parse(responseText);
              } catch {
                data = { error: responseText };
              }
            }
          } catch (textError) {
            console.error("Failed to read response", textError);
            responseText = "Unable to read response";
          }
          
          if (response.ok && !data?.error) {
            setCurrentBrandName(data.brandName || "");
            setBrandName(data.brandName || "");
          } else {
            // Revert on error
            setCurrentBrandName(originalName);
            
            let errorMessage = "Failed to update brand name";
            let errorDetails: string | unknown = null;
            
            if (data?.error) {
              if (typeof data.error === "string") {
                errorMessage = data.error;
              } else if (data.error.details) {
                errorMessage = typeof data.error.details === "string" ? data.error.details : "Error details available";
                errorDetails = data.error.details;
              } else {
                errorDetails = data.error;
              }
            } else if (responseText) {
              errorMessage = responseText;
              errorDetails = responseText;
            }
            
            setErrorPopup({
              message: errorMessage,
              status: response.status,
              statusText: response.statusText,
              details: errorDetails,
              fullError: { response: { status: response.status, statusText: response.statusText }, data, responseText }
            });
          }
        } catch (error) {
          console.error("Failed to update brand name", error);
          // Revert on error
          setCurrentBrandName(originalName);
          setErrorPopup({
            message: "Failed to update brand name",
            details: error instanceof Error ? error.message : String(error),
            fullError: error
          });
        }
      }
    }
    setEditingBrandName(false);
  }

  async function handleClearBrand() {
    setClearingBrand(true);
    try {
      const response = await fetch("/api/brand", { method: "DELETE" });
      
      let data: any = null;
      let responseText = "";
      
      try {
        responseText = await response.text();
        if (responseText) {
          try {
            data = JSON.parse(responseText);
          } catch {
            data = { error: responseText };
          }
        }
      } catch (textError) {
        console.error("Failed to read response", textError);
        responseText = "Unable to read response";
      }
      
      if (!response.ok) {
        let errorMessage = "Failed to deselect brand";
        let errorDetails: string | unknown = null;
        
        if (data?.error) {
          if (typeof data.error === "string") {
            errorMessage = data.error;
          } else if (data.error.details) {
            errorMessage = typeof data.error.details === "string" ? data.error.details : "Error details available";
            errorDetails = data.error.details;
          } else {
            errorDetails = data.error;
          }
        } else if (responseText) {
          errorMessage = responseText;
          errorDetails = responseText;
        }
        
        setErrorPopup({
          message: errorMessage,
          status: response.status,
          statusText: response.statusText,
          details: errorDetails,
          fullError: { response: { status: response.status, statusText: response.statusText }, data, responseText }
        });
        return;
      }
      
      setBrandInput("");
      setBrandName("");
      setCurrentBrandName("");
      setCurrentBrandInfo("");
      setHasBrand(false);
      onBrandUpdate?.(null, null);
    } catch (error) {
      console.error("Failed to clear brand info", error);
      setErrorPopup({
        message: "Failed to deselect brand",
        details: error instanceof Error ? error.message : String(error),
        fullError: error
      });
    } finally {
      setClearingBrand(false);
    }
  }

  function update(field: keyof ComposerSettingsInput, value: string) {
    if (field === "marketTier") {
      onChange({
        ...settings,
        marketTier: value ? (value as ComposerSettingsInput["marketTier"]) : null
      });
      return;
    }
    if (field === "characterLength" || field === "wordLength") {
       const parsed = value ? Number(value) : null;
       onChange({ ...settings, [field]: Number.isNaN(parsed) ? null : parsed });
       return;
     }
    onChange({ ...settings, [field]: value || null });
   }

  function clearAllAdjustments() {
    onChange({
      marketTier: null,
      characterLength: null,
      wordLength: null,
      gradeLevel: null,
      benchmark: null,
      avoidWords: null
    });
  }

  const hasCustomAdjustments = Boolean(
    settings.marketTier ||
    settings.characterLength ||
    settings.wordLength ||
    settings.gradeLevel ||
    settings.benchmark ||
    settings.avoidWords
  );
 
   return (
     <Transition show={open} as={Fragment}>
      <Dialog onClose={onClose} className="fixed inset-0" style={{ zIndex: 1100 }}>
        {/* Dark backdrop overlay */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60" aria-hidden="true" style={{ zIndex: 1100 }} />
        </Transition.Child>
        {open && (
          <button
            type="button"
            className="fixed inset-0 cursor-default bg-transparent"
            style={{ zIndex: 1100 }}
            onClick={onClose}
            aria-label="Dismiss brief controls"
          />
        )}
        <div className="pointer-events-none fixed inset-x-0 bottom-24 flex justify-end p-4 sm:pr-10" style={{ zIndex: 1101 }}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 translate-y-4"
            enterTo="opacity-100 translate-y-0"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-4"
          >
            <Dialog.Panel
              className="pointer-events-auto w-full max-w-lg rounded-3xl border border-brand-stroke/60 bg-[#0a0a0a]/90 backdrop-blur-[10px] p-6 text-brand-text"
              style={{
                zIndex: 1101,
                ...(anchorRect
                  ? {
                      position: "fixed",
                      bottom: `calc(64px + 3rem)`,
                      left: Math.max(16, anchorRect.left - 200),
                      right: "auto"
                    }
                  : {})
              }}
            >
               <header className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Dialog.Title className="font-display text-2xl text-brand-text">Adjust Writing</Dialog.Title>
                  {hasCustomAdjustments && (
                    <button
                      type="button"
                      onClick={clearAllAdjustments}
                      className="rounded-full border border-brand-stroke/60 bg-brand-ink/50 px-3 py-1.5 text-xs font-semibold text-brand-muted hover:border-brand-blue hover:text-brand-blue transition"
                    >
                      Clear Adjustments
                    </button>
                  )}
                </div>
                <button onClick={onClose} className="rounded-full border border-brand-stroke/70 p-2 text-brand-text hover:text-brand-blue" aria-label="Close brief controls">
                  <MinusSmallIcon className="h-5 w-5" />
                 </button>
               </header>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Character count"
                    placeholder="600"
                    type="number"
                    value={settings.characterLength ?? ""}
                    onChange={(value) => update("characterLength", value)}
                  />
                  <Field
                  label="Word count"
                    placeholder="250"
                    type="number"
                    value={settings.wordLength ?? ""}
                    onChange={(value) => update("wordLength", value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-brand-muted">Grade level</label>
                  <div className="flex flex-wrap gap-0.5">
                    <button
                      type="button"
                      onClick={() => update("gradeLevel", "")}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                        !settings.gradeLevel
                          ? "border-white bg-white text-black"
                          : "border-brand-stroke/70 bg-brand-ink text-brand-muted hover:border-brand-blue hover:text-white"
                      )}
                    >
                      Auto
                    </button>
                    {[
                      { value: "ESL (English as Second Language)", label: "ESL", tooltip: "English as a Second Language" },
                      { value: "Grade 5", label: "5th", example: "This is fun!" },
                      { value: "Grade 9", label: "9th", example: "This works well." },
                      { value: "Grade 12", label: "12th", example: "This is effective." },
                      { value: "Collegiate", label: "Collegiate", example: "This demonstrates efficacy." },
                      { value: "PhD", label: "PhD", example: "This evinces methodological rigor." }
                    ].map((level) => {
                      const isESL = level.value === "ESL (English as Second Language)";
                      const showTooltip = isESL ? showESLTooltip : hoveredGradeLevel === level.value;
                      const tooltipText = isESL ? level.tooltip : level.example;
                      
                      return (
                        <div key={level.value} className="relative">
                          <button
                            type="button"
                            onClick={() => update("gradeLevel", level.value)}
                            onMouseEnter={() => {
                              if (isESL) {
                                const timeout = setTimeout(() => {
                                  setShowESLTooltip(true);
                                }, 500);
                                setEslTooltipTimeout(timeout);
                              } else if (level.example) {
                                const timeout = setTimeout(() => {
                                  setHoveredGradeLevel(level.value);
                                }, 500);
                                setGradeLevelTooltipTimeout(timeout);
                              }
                            }}
                            onMouseLeave={() => {
                              if (isESL) {
                                if (eslTooltipTimeout) {
                                  clearTimeout(eslTooltipTimeout);
                                  setEslTooltipTimeout(null);
                                }
                                setShowESLTooltip(false);
                              } else {
                                if (gradeLevelTooltipTimeout) {
                                  clearTimeout(gradeLevelTooltipTimeout);
                                  setGradeLevelTooltipTimeout(null);
                                }
                                setHoveredGradeLevel(null);
                              }
                            }}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                              settings.gradeLevel === level.value
                                ? "border-white bg-white text-black"
                                : "border-brand-stroke/70 bg-brand-ink text-brand-muted hover:border-brand-blue hover:text-white"
                            )}
                          >
                            {level.label}
                          </button>
                          {showTooltip && tooltipText && (
                            <div
                              className={cn(
                                "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded border border-brand-stroke/60 bg-brand-panel text-xs text-brand-text whitespace-nowrap z-50 pointer-events-none",
                                !isESL && "italic"
                              )}
                            >
                              {isESL ? tooltipText : <>i.e. &ldquo;{tooltipText}&rdquo;</>}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                                <div className="border-4 border-transparent border-t-brand-stroke/60"></div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-brand-muted">Market</label>
                  <div className="flex flex-wrap gap-0.5">
                    <button
                      type="button"
                      onClick={() => update("marketTier", "")}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                        !settings.marketTier
                          ? "border-white bg-white text-black"
                          : "border-brand-stroke/70 bg-brand-ink text-brand-muted hover:border-brand-blue hover:text-white"
                      )}
                    >
                      Auto
                    </button>
                    {marketTiers.map((tier) => (
                      <div key={tier} className="relative">
                        <button
                          type="button"
                          onClick={() => update("marketTier", tier)}
                          onMouseEnter={() => {
                            const timeout = setTimeout(() => {
                              setHoveredMarketTier(tier);
                            }, 500);
                            setMarketTierTooltipTimeout(timeout);
                          }}
                          onMouseLeave={() => {
                            if (marketTierTooltipTimeout) {
                              clearTimeout(marketTierTooltipTimeout);
                              setMarketTierTooltipTimeout(null);
                            }
                            setHoveredMarketTier(null);
                          }}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                            settings.marketTier === tier
                              ? "border-white bg-white text-black"
                              : "border-brand-stroke/70 bg-brand-ink text-brand-muted hover:border-brand-blue hover:text-white"
                          )}
                        >
                          {marketLabels[tier]} <sup className="text-[0.5em] leading-none">{marketDollarSigns[tier]}</sup>
                        </button>
                        {hoveredMarketTier === tier && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded border border-brand-stroke/60 bg-brand-panel text-xs text-brand-text whitespace-nowrap z-50 pointer-events-none italic">
                            i.e. &ldquo;{marketExamples[tier]}&rdquo;
                            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                              <div className="border-4 border-transparent border-t-brand-stroke/60"></div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-brand-muted whitespace-nowrap w-24">Benchmark</label>
                  <input
                    type="text"
                    placeholder="Tom Ford"
                    value={settings.benchmark ?? ""}
                    onChange={(e) => update("benchmark", e.target.value)}
                    className="flex-1 rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:border-brand-blue focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-brand-muted whitespace-nowrap w-24">Avoid words</label>
                  <input
                    type="text"
                    placeholder="budget, cheap"
                    value={settings.avoidWords ?? ""}
                    onChange={(e) => update("avoidWords", e.target.value)}
                    className="flex-1 rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:border-brand-blue focus:outline-none"
                  />
                </div>
                <div className="pt-2 border-t border-brand-stroke/60">
                  <div className="flex items-center gap-3 mb-4">
                    <label className="text-sm text-brand-muted whitespace-nowrap w-24">Select brand</label>
                    <select
                      value={hasBrand ? "current" : ""}
                      onChange={(e) => {
                        if (e.target.value === "current" && hasBrand) {
                          // Brand is already selected, this is just for display
                        }
                      }}
                      className="flex-1 rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text focus:border-brand-blue focus:outline-none"
                      disabled={!hasBrand}
                    >
                      {hasBrand ? (
                        <option value="current">{currentBrandName || "Untitled Brand"}</option>
                      ) : (
                        <option value="">No brand defined</option>
                      )}
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-sm text-brand-muted whitespace-nowrap w-24">Brand</label>
                    {hasBrand && (
                      <div className="flex-1 flex items-center gap-2">
                        {editingBrandName ? (
                          <>
                            <input
                              type="text"
                              value={currentBrandName}
                              onChange={(e) => setCurrentBrandName(e.target.value)}
                              onBlur={handleUpdateBrandName}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  handleUpdateBrandName();
                                } else if (e.key === "Escape") {
                                  // Reset to original value
                                  setCurrentBrandName(brandName || "");
                                  setEditingBrandName(false);
                                }
                              }}
                              maxLength={100}
                              className="flex-1 rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text focus:border-brand-blue focus:outline-none"
                              autoFocus
                            />
                          </>
                        ) : (
                          <div
                            onClick={() => {
                              setBrandName(currentBrandName);
                              setEditingBrandName(true);
                            }}
                            className="flex-1 rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text cursor-text hover:border-brand-blue transition"
                          >
                            {currentBrandName || "Untitled Brand"}
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (hasBrand) {
                          setBrandInput(currentBrandInfo);
                          setBrandName(currentBrandName);
                        } else {
                          setBrandInput("");
                          setBrandName("");
                        }
                        setBrandModalOpen(true);
                      }}
                      className="rounded-full border border-brand-stroke/70 bg-brand-ink px-4 py-2 text-sm font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue whitespace-nowrap"
                    >
                      {hasBrand ? "Update Brand" : "Define Brand"}
                    </button>
                  </div>
                  {hasBrand && (
                    <button
                      type="button"
                      onClick={handleClearBrand}
                      disabled={clearingBrand}
                      className="mt-2 ml-[108px] rounded-full border border-brand-stroke/60 px-4 py-2 text-xs font-semibold text-brand-muted transition hover:border-brand-blue hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {clearingBrand ? "Deselecting..." : "Deselect Brand"}
                    </button>
                  )}
                </div>
               </div>
             </Dialog.Panel>
           </Transition.Child>
         </div>
       </Dialog>
       <Transition show={brandModalOpen} as={Fragment}>
         <Dialog onClose={() => setBrandModalOpen(false)} className="relative z-[1200]">
           <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
           <div className="fixed inset-0 flex items-center justify-center p-4">
             <Transition.Child
               as={Fragment}
               enter="ease-out duration-200"
               enterFrom="opacity-0 scale-95"
               enterTo="opacity-100 scale-100"
               leave="ease-in duration-150"
               leaveFrom="opacity-100 scale-100"
               leaveTo="opacity-0 scale-95"
             >
               <Dialog.Panel className="w-full max-w-2xl rounded-3xl border border-brand-stroke/60 bg-brand-panel/95 p-6 text-brand-text shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
                 <header className="mb-4 flex items-center justify-between">
                   <Dialog.Title className="font-display text-2xl text-brand-text">Define Brand</Dialog.Title>
                   <button
                     onClick={() => setBrandModalOpen(false)}
                     className="rounded-full border border-brand-stroke/70 p-2 text-brand-text hover:text-brand-blue"
                     aria-label="Close"
                   >
                     <MinusSmallIcon className="h-5 w-5" />
                   </button>
                 </header>
                 <div className="space-y-4">
                   <div>
                     <label className="text-sm text-brand-muted">Brand Name</label>
                     <input
                       type="text"
                       value={brandName}
                       onChange={(e) => setBrandName(e.target.value.substring(0, 100))}
                       placeholder="Enter brand name (optional)"
                       maxLength={100}
                       className="mt-2 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:border-brand-blue focus:outline-none"
                     />
                   </div>
                   <div>
                     <label className="text-sm text-brand-muted">
                       Paste your brand information, style guides, vocabulary, tone, and any other details about your brand. The AI will create a concise 400-character summary.
                     </label>
                     <textarea
                       value={brandInput}
                       onChange={(e) => setBrandInput(e.target.value)}
                       placeholder="Paste brand information here..."
                       className="mt-2 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:border-brand-blue focus:outline-none"
                       rows={12}
                     />
                   </div>
                   <div className="flex justify-end gap-3">
                     <button
                       type="button"
                       onClick={() => setBrandModalOpen(false)}
                       className="rounded-full border border-brand-stroke/70 px-4 py-2 text-sm font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue"
                     >
                       Cancel
                     </button>
                     <button
                       type="button"
                       onClick={handleDefineBrand}
                       disabled={!brandInput.trim() || brandProcessing}
                       className="rounded-full bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue/80 disabled:opacity-60 disabled:cursor-not-allowed"
                     >
                       {brandProcessing ? "Processing..." : "Save Brand"}
                     </button>
                   </div>
                 </div>
               </Dialog.Panel>
             </Transition.Child>
           </div>
         </Dialog>
      </Transition>
      <ErrorPopup error={errorPopup} onClose={() => setErrorPopup(null)} />
    </Transition>
   );
 }

type FieldProps = {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  textarea?: boolean;
};

function Field({ label, value, onChange, placeholder, type = "text", textarea }: FieldProps) {
  const shared =
    "mt-1 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:border-brand-blue focus:outline-none";
  return (
    <div>
      <label className="text-sm text-brand-muted">{label}</label>
      {textarea ? (
        <textarea
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={shared}
          rows={3}
        />
      ) : (
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={shared}
        />
      )}
    </div>
  );
}

