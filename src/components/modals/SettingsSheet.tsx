 "use client";
 
 import { Dialog, Transition } from "@headlessui/react";
 import { Fragment, useState, useEffect } from "react";
import { MinusSmallIcon } from "@heroicons/react/24/outline";
 import { ComposerSettingsInput, marketTiers } from "@/lib/validators";
 import { cn } from "@/lib/utils";
 import { ErrorPopup, type ErrorDetails } from "@/components/shared/ErrorPopup";
 
// Simplified type for styles passed to SettingsSheet
// The actual SavedDoc type has more fields, but we only need these for the dropdown
type StyleDoc = {
  id: string;
  title: string;
  writingStyle?: string | null;
  [key: string]: unknown; // Allow other properties to satisfy SavedDoc type
};

type SettingsSheetProps = {
  open: boolean;
  onClose: () => void;
  settings: ComposerSettingsInput;
  onChange: (next: ComposerSettingsInput) => void;
  anchorRect: DOMRect | null;
  onPersonaUpdate?: (summary: string | null, name?: string | null) => void;
  initialPersonaDefined?: boolean;
  activePersonaId?: string | null;
  styles?: StyleDoc[];
  activeStyleId?: string;
  onApplyStyle?: (style: StyleDoc) => void;
  onClearStyle?: () => void;
  openPersonaModal?: boolean;
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
  onPersonaUpdate,
  initialPersonaDefined = false,
  activePersonaId,
  styles = [],
  activeStyleId,
  onApplyStyle,
  onClearStyle,
  openPersonaModal = false
}: SettingsSheetProps) {
  const [personaModalOpen, setPersonaModalOpen] = useState(false);
  const [personaInput, setPersonaInput] = useState("");
  const [personaName, setPersonaName] = useState("");
  const [personaProcessing, setPersonaProcessing] = useState(false);
  const [hasPersona, setHasPersona] = useState(initialPersonaDefined);
  const [clearingPersona, setClearingPersona] = useState(false);
  const [editingPersonaName, setEditingPersonaName] = useState(false);
  const [currentPersonaName, setCurrentPersonaName] = useState("");
  const [currentPersonaInfo, setCurrentPersonaInfo] = useState("");
  const [showESLTooltip, setShowESLTooltip] = useState(false);
  const [eslTooltipTimeout, setEslTooltipTimeout] = useState<NodeJS.Timeout | null>(null);
  const [hoveredGradeLevel, setHoveredGradeLevel] = useState<string | null>(null);
  const [gradeLevelTooltipTimeout, setGradeLevelTooltipTimeout] = useState<NodeJS.Timeout | null>(null);
  const [hoveredMarketTier, setHoveredMarketTier] = useState<string | null>(null);
  const [marketTierTooltipTimeout, setMarketTierTooltipTimeout] = useState<NodeJS.Timeout | null>(null);
  const [errorPopup, setErrorPopup] = useState<ErrorDetails | null>(null);
  const [personaOptions, setPersonaOptions] = useState<Array<{ id: string; name: string | null; info: string }>>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("");

  useEffect(() => {
    setHasPersona(initialPersonaDefined);
  }, [initialPersonaDefined]);

  // Open persona modal when openPersonaModal prop is true
  useEffect(() => {
    if (open && openPersonaModal) {
      setPersonaInput("");
      setPersonaName("");
      setPersonaModalOpen(true);
    }
  }, [open, openPersonaModal]);

  // Sync selectedPersonaId when activePersonaId changes from parent (e.g., when persona is selected in sidebar)
  useEffect(() => {
    // Only sync if activePersonaId prop is provided and different from current selection
    if (activePersonaId === undefined) return; // Don't sync if prop not provided
    
    if (activePersonaId !== null && activePersonaId !== selectedPersonaId) {
      // Find the persona in current options
      const persona = personaOptions.find((p) => p.id === activePersonaId);
      if (persona) {
        // Only update if actually different to avoid unnecessary re-renders
        setSelectedPersonaId(activePersonaId);
        const summary = persona.info ?? null;
        const name = persona.name ?? null;
        const newHasPersona = Boolean(summary) || Boolean(name);
        if (newHasPersona !== hasPersona || currentPersonaName !== name || currentPersonaInfo !== summary) {
          setHasPersona(newHasPersona);
          setCurrentPersonaName(name || "");
          setCurrentPersonaInfo(summary || "");
          onPersonaUpdate?.(summary, name);
        }
      } else {
        // Persona not in current options, fetch fresh list
        fetch("/api/persona?all=true")
          .then((res) => res.json())
          .then((data) => {
            if (data.brands && Array.isArray(data.brands)) {
              setPersonaOptions(data.brands);
              const persona = data.brands.find((p: any) => p.id === activePersonaId);
              if (persona) {
                setSelectedPersonaId(activePersonaId);
                const summary = persona.info ?? null;
                const name = persona.name ?? null;
                setHasPersona(Boolean(summary) || Boolean(name));
                setCurrentPersonaName(name || "");
                setCurrentPersonaInfo(summary || "");
                onPersonaUpdate?.(summary, name);
              }
            }
          })
          .catch((err) => console.error("Failed to sync persona", err));
      }
    } else if (activePersonaId === null && selectedPersonaId) {
      // Persona was deselected in parent
      setSelectedPersonaId("");
      setHasPersona(false);
      setCurrentPersonaName("");
      setCurrentPersonaInfo("");
      onPersonaUpdate?.(null, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePersonaId]); // Only depend on activePersonaId to avoid unnecessary runs

  // Check if persona is defined on mount and when modal opens
  useEffect(() => {
    if (!open) {
      // Don't reset selectedPersonaId when modal closes - preserve user's selection
      return;
    }
    
    async function checkPersona() {
      try {
        // Prefer full personas list (includes activePersonaId and stored personas even if deselected)
        const listResponse = await fetch("/api/persona?all=true");
        if (listResponse.ok) {
          const data = await listResponse.json();
          if (Array.isArray(data.brands) && data.brands.length > 0) {
            setPersonaOptions(data.brands);
            // Use activePersonaId prop if provided, otherwise use data.activeBrandId
            const activeId = activePersonaId ?? data.activeBrandId ?? "";
            // Only set on initial load (when selectedPersonaId is empty) or if activePersonaId changed
            const finalSelectedId = (() => {
              // If user hasn't selected anything yet, use activePersonaId
              if (!selectedPersonaId) return activeId;
              // If user selected a persona, keep their selection unless it's no longer valid
              const isValidSelection = data.brands.some((p: any) => p.id === selectedPersonaId);
              if (isValidSelection) return selectedPersonaId;
              // If selection is invalid, fall back to activePersonaId
              return activeId;
            })();
            
            setSelectedPersonaId(finalSelectedId);
            
            // Use the selected persona (either user's selection or active persona) to set state
            const selectedPersona = data.brands.find((p: any) => p.id === finalSelectedId);
            if (selectedPersona) {
              const summary = selectedPersona.info ?? null;
              const name = selectedPersona.name ?? null;
              setHasPersona(Boolean(summary) || Boolean(name));
              setCurrentPersonaName(name || "");
              setCurrentPersonaInfo(summary || "");
              onPersonaUpdate?.(summary, name);
            } else {
              // No selection; keep defaults but allow dropdown to show options
              setHasPersona(false);
              setCurrentPersonaName("");
              setCurrentPersonaInfo("");
            }
            return;
          } else {
            setPersonaOptions([]);
            setSelectedPersonaId("");
          }
        }

        // Fallback to legacy single-persona endpoint (guests or no personas)
        const response = await fetch("/api/persona");
        if (response.ok) {
          const data = await response.json();
          const summary = data.personaInfo ?? null;
          const name = data.personaName ?? null;
          setHasPersona(Boolean(summary) || Boolean(name));
          setCurrentPersonaName(name || "");
          setCurrentPersonaInfo(summary || "");
          onPersonaUpdate?.(summary, name);
        }
      } catch (error) {
        console.error("Failed to check persona info", error);
      }
    }
    if (open) {
      checkPersona();
    } else {
      // Reset selectedPersonaId when modal closes so it can reload fresh next time
      setSelectedPersonaId("");
    }
  }, [open, activePersonaId]);

  async function handleDefinePersona() {
    console.log("handleDefinePersona called", { 
      personaInput: personaInput, 
      personaInputLength: personaInput?.length,
      personaInputTrimmed: personaInput?.trim(),
      hasContent: !!personaInput?.trim()
    });
    
    if (!personaInput.trim()) {
      console.warn("Persona input is empty, returning early");
      return;
    }
    
    console.log("Starting persona save process...");
    setPersonaProcessing(true);
    try {
      const requestBody = { 
        personaName: personaName?.trim() || undefined,
        personaInfo: personaInput.trim() 
      };
      
      console.log("Sending persona save request:", { 
        hasPersonaName: !!requestBody.personaName,
        hasPersonaInfo: !!requestBody.personaInfo,
        personaInfoLength: requestBody.personaInfo?.length
      });
      
      const response = await fetch("/api/persona", {
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
      if (response.ok && !data?.error && (data?.personaInfo || data?.personaName || data?.success)) {
        console.log("Persona save successful:", { 
          personaName: data.personaName, 
          hasPersonaInfo: !!data.personaInfo 
        });
        const summary = data.personaInfo ?? null;
        const name = data.personaName ?? null;
        setPersonaInput("");
        setPersonaName("");
        setPersonaModalOpen(false);
        setHasPersona(!!summary);
        setCurrentPersonaName(name || "");
        setCurrentPersonaInfo(summary || "");
        onPersonaUpdate?.(summary, name);
      } else {
        // Handle Zod validation errors or other errors
        let errorMessage = "Failed to save persona";
        let errorDetails: string | unknown = null;
        
        // Log full response for debugging - log each piece separately to avoid serialization issues
        console.error("=== PERSONA SAVE ERROR DEBUG ===");
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
            errorMessage = "An error occurred while saving the persona";
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
      console.error("Failed to save persona info - Exception:", error);
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
      setPersonaProcessing(false);
    }
  }
  
  async function handleUpdatePersonaName() {
    if (editingPersonaName) {
      const originalName = personaName || "";
      if (currentPersonaName.trim() !== originalName.trim()) {
        try {
          const response = await fetch("/api/persona", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              personaName: currentPersonaName.trim() || null,
              personaInfo: currentPersonaInfo 
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
            setCurrentPersonaName(data.personaName || "");
            setPersonaName(data.personaName || "");
          } else {
            // Revert on error
            setCurrentPersonaName(originalName);
            
            let errorMessage = "Failed to update persona name";
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
          console.error("Failed to update persona name", error);
          // Revert on error
          setCurrentPersonaName(originalName);
          setErrorPopup({
            message: "Failed to update persona name",
            details: error instanceof Error ? error.message : String(error),
            fullError: error
          });
        }
      }
    }
    setEditingPersonaName(false);
  }

  async function handleClearPersona() {
    setClearingPersona(true);
    try {
      const response = await fetch("/api/persona", { method: "DELETE" });
      
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
        let errorMessage = "Failed to deselect persona";
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
      
      setPersonaInput("");
      setPersonaName("");
      setCurrentPersonaName("");
      setCurrentPersonaInfo("");
      setHasPersona(false);
      setSelectedPersonaId(""); // Reset dropdown to "Select Persona"
      onPersonaUpdate?.(null, null);
    } catch (error) {
      console.error("Failed to clear persona info", error);
      setErrorPopup({
        message: "Failed to deselect persona",
        details: error instanceof Error ? error.message : String(error),
        fullError: error
      });
    } finally {
      setClearingPersona(false);
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

  async function clearAllAdjustments() {
    onChange({
      marketTier: null,
      characterLength: null,
      wordLength: null,
      gradeLevel: null,
      benchmark: null,
      avoidWords: null
    });
    
    // Also deselect persona if one is selected
    if (hasPersona) {
      await handleClearPersona();
    }
  }

  const hasCustomAdjustments = Boolean(
    settings.marketTier ||
    settings.characterLength ||
    settings.wordLength ||
    settings.gradeLevel ||
    settings.benchmark ||
    settings.avoidWords ||
    hasPersona
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
              className="pointer-events-auto w-full max-w-lg rounded-3xl border border-brand-stroke/60 bg-[#0a0a0a]/90 backdrop-blur-[10px] p-6 text-brand-text overflow-visible"
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
                  {styles.length > 0 ? (
                    <div className="flex items-center gap-3 mb-4">
                      <label className="text-sm text-brand-muted whitespace-nowrap w-24 flex-shrink-0">Style</label>
                      <select
                        value={activeStyleId || ""}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          if (!nextId) {
                            onClearStyle?.();
                            return;
                          }
                          const match = styles.find((s) => s.id === nextId);
                          if (match && onApplyStyle) {
                            onApplyStyle(match);
                          }
                        }}
                        className="flex-1 min-w-0 rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text focus:border-brand-blue focus:outline-none"
                      >
                        <option value="">Select Style</option>
                        {styles.map((s) => {
                          const title = s.title || "Untitled Style";
                          const truncatedTitle = title.length > 50 ? title.substring(0, 47) + "..." : title;
                          return (
                            <option key={s.id} value={s.id} title={title}>
                              {truncatedTitle}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 mb-4">
                      <label className="text-sm text-brand-muted whitespace-nowrap w-24">Style</label>
                      <div className="flex-1 rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-sm text-brand-muted/50">
                        Select Text in Doc to Add Styles
                      </div>
                    </div>
                  )}
                  {personaOptions.length > 0 ? (
                    <div className="flex items-center gap-3">
                      <label className="text-sm text-brand-muted whitespace-nowrap w-24">Persona</label>
                      <select
                        value={selectedPersonaId}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          setSelectedPersonaId(nextId);
                          if (!nextId) {
                            setHasPersona(false);
                            setCurrentPersonaName("");
                            setCurrentPersonaInfo("");
                            onPersonaUpdate?.(null, null);
                            return;
                          }
                          const match = personaOptions.find((p) => p.id === nextId);
                          if (match) {
                            const summary = match.info ?? null;
                            const name = match.name ?? null;
                            setHasPersona(Boolean(summary) || Boolean(name));
                            setCurrentPersonaName(name || "");
                            setCurrentPersonaInfo(summary || "");
                            onPersonaUpdate?.(summary, name);
                          }
                        }}
                        className="flex-1 rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text focus:border-brand-blue focus:outline-none"
                      >
                        <option value="">Select Persona</option>
                        {personaOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name || "Untitled Persona"}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          if (hasPersona) {
                            setPersonaInput(currentPersonaInfo);
                            setPersonaName(currentPersonaName);
                          } else {
                            setPersonaInput("");
                            setPersonaName("");
                          }
                          setPersonaModalOpen(true);
                        }}
                        className="rounded-full border border-brand-stroke/70 bg-brand-ink p-2 text-brand-text transition hover:border-brand-blue hover:text-brand-blue flex-shrink-0"
                        aria-label="Define persona"
                        title="Define persona"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <label className="text-sm text-brand-muted whitespace-nowrap w-24">Persona</label>
                      <button
                        type="button"
                        onClick={() => {
                          setPersonaInput("");
                          setPersonaName("");
                          setPersonaModalOpen(true);
                        }}
                        className="rounded-full border border-brand-stroke/70 bg-brand-ink p-2 text-brand-text transition hover:border-brand-blue hover:text-brand-blue flex-shrink-0"
                        aria-label="Define persona"
                        title="Define persona"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
               </div>
             </Dialog.Panel>
           </Transition.Child>
         </div>
       </Dialog>
       <Transition show={personaModalOpen} as={Fragment}>
         <Dialog onClose={() => setPersonaModalOpen(false)} className="relative z-[1200]">
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
                   <Dialog.Title className="font-display text-2xl text-brand-text">Define Persona</Dialog.Title>
                   <button
                     onClick={() => setPersonaModalOpen(false)}
                     className="rounded-full border border-brand-stroke/70 p-2 text-brand-text hover:text-brand-blue"
                     aria-label="Close"
                   >
                     <MinusSmallIcon className="h-5 w-5" />
                   </button>
                 </header>
                 <div className="space-y-4">
                   <div>
                     <label className="text-sm text-brand-muted">Persona Name</label>
                     <input
                       type="text"
                       value={personaName}
                       onChange={(e) => setPersonaName(e.target.value.substring(0, 100))}
                       placeholder="Enter persona name (optional)"
                       maxLength={100}
                       className="mt-2 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:border-brand-blue focus:outline-none"
                     />
                   </div>
                   <div>
                     <label className="text-sm text-brand-muted">
                       Paste your persona information, style guides, vocabulary, tone, and any other details about your persona. The AI will create a concise 400-character summary.
                     </label>
                     <textarea
                       value={personaInput}
                       onChange={(e) => setPersonaInput(e.target.value)}
                       placeholder="Paste persona information here..."
                       className="mt-2 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:border-brand-blue focus:outline-none"
                       rows={12}
                     />
                   </div>
                   <div className="flex justify-end gap-3">
                     <button
                       type="button"
                       onClick={() => setPersonaModalOpen(false)}
                       className="rounded-full border border-brand-stroke/70 px-4 py-2 text-sm font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue"
                     >
                       Cancel
                     </button>
                     <button
                       type="button"
                       onClick={handleDefinePersona}
                       disabled={!personaInput.trim() || personaProcessing}
                       className="rounded-full bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue/80 disabled:opacity-60 disabled:cursor-not-allowed"
                     >
                       {personaProcessing ? "Processing..." : "Save Persona"}
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

