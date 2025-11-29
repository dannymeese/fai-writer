 "use client";
 
 import { Dialog, Transition } from "@headlessui/react";
 import { Fragment } from "react";
 import { XMarkIcon } from "@heroicons/react/24/outline";
 import { ComposerSettingsInput, marketTiers } from "@/lib/validators";
 
 type SettingsSheetProps = {
   open: boolean;
   onClose: () => void;
   settings: ComposerSettingsInput;
   onChange: (next: ComposerSettingsInput) => void;
 };
 
 const marketLabels = {
   MASS: "Mass ($)",
   PREMIUM: "Premium ($$)",
   LUXURY: "Luxury ($$$)",
   UHNW: "UHNW ($$$$$)"
 } as const;
 
 export default function SettingsSheet({ open, onClose, settings, onChange }: SettingsSheetProps) {
  function update(field: keyof ComposerSettingsInput, value: string) {
    if (field === "marketTier") {
      onChange({ ...settings, marketTier: value as ComposerSettingsInput["marketTier"] });
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
         <Transition.Child
           as={Fragment}
           enter="ease-out duration-200"
           enterFrom="opacity-0"
           enterTo="opacity-100"
           leave="ease-in duration-150"
           leaveFrom="opacity-100"
           leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />
         </Transition.Child>
         <div className="fixed inset-0 flex items-end justify-center p-4 sm:items-center">
           <Transition.Child
             as={Fragment}
             enter="ease-out duration-200"
             enterFrom="opacity-0 translate-y-6"
             enterTo="opacity-100 translate-y-0"
             leave="ease-in duration-150"
             leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-6"
          >
            <Dialog.Panel className="w-full max-w-lg rounded-3xl border border-brand-stroke/60 bg-brand-panel/95 p-6 text-brand-text shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
               <header className="mb-4 flex items-center justify-between">
                 <div>
                  <Dialog.Title className="font-display text-2xl text-brand-text">
                     Brief controls
                   </Dialog.Title>
                  <p className="text-sm text-brand-muted">
                     Set tone, benchmarks, and what words to dodge.
                   </p>
                 </div>
                <button onClick={onClose} className="rounded-full border border-brand-stroke/70 p-2 text-brand-text hover:text-brand-blue">
                   <XMarkIcon className="h-5 w-5" />
                 </button>
               </header>
               <div className="space-y-4">
                 <div>
                  <label className="text-sm text-brand-muted">Choose market</label>
                   <select
                     value={settings.marketTier}
                     onChange={(e) => update("marketTier", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text focus:border-brand-blue focus:outline-none"
                   >
                     {marketTiers.map((tier) => (
                       <option key={tier} value={tier}>
                         {marketLabels[tier]}
                       </option>
                     ))}
                   </select>
                 </div>
                 <div className="grid gap-4 sm:grid-cols-2">
                   <Field
                     label="Enter character length"
                     placeholder="600"
                     type="number"
                     value={settings.characterLength ?? ""}
                     onChange={(value) => update("characterLength", value)}
                   />
                   <Field
                     label="Enter word length"
                     placeholder="250"
                     type="number"
                     value={settings.wordLength ?? ""}
                     onChange={(value) => update("wordLength", value)}
                   />
                 </div>
                 <Field
                   label="Choose grade level"
                   placeholder="Grade 10"
                   value={settings.gradeLevel ?? ""}
                   onChange={(value) => update("gradeLevel", value)}
                 />
                 <Field
                   label="Enter benchmark"
                   placeholder="Tom Ford"
                   value={settings.benchmark ?? ""}
                   onChange={(value) => update("benchmark", value)}
                 />
                 <Field
                   label="Enter avoid words"
                   placeholder="budget, cheap"
                   value={settings.avoidWords ?? ""}
                   onChange={(value) => update("avoidWords", value)}
                   textarea
                 />
               </div>
              <div className="mt-6 flex justify-end gap-2">
                 <button
                   onClick={onClose}
                  className="rounded-full border border-brand-stroke/70 px-4 py-2 text-sm font-semibold text-brand-text hover:border-brand-blue hover:text-brand-blue"
                 >
                   Close
                 </button>
               </div>
             </Dialog.Panel>
           </Transition.Child>
         </div>
       </Dialog>
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
    "mt-1 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text placeholder:text-brand-muted focus:border-brand-blue focus:outline-none";
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

