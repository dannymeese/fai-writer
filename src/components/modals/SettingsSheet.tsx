 "use client";
 
 import { Dialog, Transition } from "@headlessui/react";
 import { Fragment, useState } from "react";
import { MinusSmallIcon } from "@heroicons/react/24/outline";
 import { ComposerSettingsInput, marketTiers } from "@/lib/validators";
 
type SettingsSheetProps = {
  open: boolean;
  onClose: () => void;
  settings: ComposerSettingsInput;
  onChange: (next: ComposerSettingsInput) => void;
  anchorRect: DOMRect | null;
};
 
const marketLabels = {
  MASS: "Mass ($)",
  PREMIUM: "Premium ($$)",
  LUXURY: "Luxury ($$$)",
  UHNW: "UHNW ($$$$$)"
} as const;
 
export default function SettingsSheet({ open, onClose, settings, onChange, anchorRect }: SettingsSheetProps) {
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [brandInput, setBrandInput] = useState("");
  const [brandProcessing, setBrandProcessing] = useState(false);

  async function handleDefineBrand() {
    if (!brandInput.trim()) {
      return;
    }
    setBrandProcessing(true);
    try {
      const response = await fetch("/api/brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandInfo: brandInput })
      });
      if (response.ok) {
        setBrandInput("");
        setBrandModalOpen(false);
      }
    } catch (error) {
      console.error("Failed to save brand info", error);
    } finally {
      setBrandProcessing(false);
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
 
   return (
     <Transition show={open} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        <div className="fixed inset-0 pointer-events-none" aria-hidden="true" />
        {open && (
          <button
            type="button"
            className="fixed inset-0 cursor-default bg-transparent"
            onClick={onClose}
            aria-label="Dismiss brief controls"
          />
        )}
        <div className="pointer-events-none fixed inset-x-0 bottom-24 flex justify-end p-4 sm:pr-10">
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
              className="pointer-events-auto w-full max-w-lg rounded-3xl border border-brand-stroke/60 bg-brand-panel/95 p-6 text-brand-text shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
              style={
                anchorRect
                  ? {
                      position: "fixed",
                      bottom: `calc(64px + 3rem)`,
                      left: Math.max(16, anchorRect.left - 200),
                      right: "auto"
                    }
                  : undefined
              }
            >
               <header className="mb-4 flex items-center justify-between">
                <div>
                  <Dialog.Title className="font-display text-2xl text-brand-text">Adjust Writing</Dialog.Title>
                </div>
                <button onClick={onClose} className="rounded-full border border-brand-stroke/70 p-2 text-brand-text hover:text-brand-blue" aria-label="Close brief controls">
                  <MinusSmallIcon className="h-5 w-5" />
                 </button>
               </header>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Character length"
                    placeholder="600"
                    type="number"
                    value={settings.characterLength ?? ""}
                    onChange={(value) => update("characterLength", value)}
                  />
                  <Field
                    label="Word length"
                    placeholder="250"
                    type="number"
                    value={settings.wordLength ?? ""}
                    onChange={(value) => update("wordLength", value)}
                  />
                </div>
                <div>
                  <label className="text-sm text-brand-muted">Choose market</label>
                  <select
                    value={settings.marketTier ?? ""}
                    onChange={(e) => update("marketTier", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text focus:border-brand-blue focus:outline-none"
                  >
                    <option value="">Auto</option>
                    {marketTiers.map((tier) => (
                      <option key={tier} value={tier}>
                        {marketLabels[tier]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-brand-muted">Choose grade level</label>
                  <select
                    value={settings.gradeLevel ?? ""}
                    onChange={(e) => update("gradeLevel", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text focus:border-brand-blue focus:outline-none"
                  >
                    <option value="">Auto</option>
                    <option value="ESL (English as Second Language)">ESL (English as Second Language)</option>
                    <option value="Grade 5">Grade 5</option>
                    <option value="Grade 9">Grade 9</option>
                    <option value="Grade 12">Grade 12</option>
                    <option value="Collegiate">Collegiate</option>
                    <option value="PhD">PhD</option>
                  </select>
                </div>
                <Field
                  label="Benchmark"
                  placeholder="Tom Ford"
                  value={settings.benchmark ?? ""}
                  onChange={(value) => update("benchmark", value)}
                />
                <Field
                  label="Avoid words"
                  placeholder="budget, cheap"
                  value={settings.avoidWords ?? ""}
                  onChange={(value) => update("avoidWords", value)}
                />
                <div className="pt-2 border-t border-brand-stroke/60">
                  <button
                    type="button"
                    onClick={() => setBrandModalOpen(true)}
                    className="w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-4 py-2 text-sm font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue"
                  >
                    Define Brand
                  </button>
                </div>
               </div>
             </Dialog.Panel>
           </Transition.Child>
         </div>
       </Dialog>
       <Transition show={brandModalOpen} as={Fragment}>
         <Dialog onClose={() => setBrandModalOpen(false)} className="relative z-50">
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
                     <label className="text-sm text-brand-muted">
                       Paste your brand information, style guides, vocabulary, tone, and any other details about your brand.
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
                       className="rounded-lg border border-brand-stroke/70 px-4 py-2 text-sm font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue"
                     >
                       Cancel
                     </button>
                     <button
                       type="button"
                       onClick={handleDefineBrand}
                       disabled={!brandInput.trim() || brandProcessing}
                       className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue/80 disabled:opacity-60 disabled:cursor-not-allowed"
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

