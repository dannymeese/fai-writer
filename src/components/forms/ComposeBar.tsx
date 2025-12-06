"use client";

import { XMarkIcon } from "@heroicons/react/24/outline";
import { WrenchIcon } from "@heroicons/react/24/solid";
import { cn, getPromptHistory, PromptHistoryEntry } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

// TypeScript definitions for Web Speech API
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

declare global {
  interface Window {
    SpeechRecognition: {
      new (): SpeechRecognition;
    };
    webkitSpeechRecognition: {
      new (): SpeechRecognition;
    };
  }
}

type ComposeBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  loading?: boolean;
  onToggleSettings: (anchorRect: DOMRect | null) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement>;
  compact?: boolean;
  hasCustomOptions?: boolean;
  activeStyle?: {
    id: string;
    name: string;
  } | null;
  onClearStyle?: () => void;
  activePersona?: {
    id: string;
    name: string;
  } | null;
  onClearPersona?: () => void;
  hasSelection?: boolean;
  selectedText?: string | null;
  isGuest?: boolean;
};

export default function ComposeBar({
  value,
  onChange,
  onSubmit,
  disabled,
  loading = false,
  onToggleSettings,
  inputRef,
  compact = false,
  hasCustomOptions = false,
  activeStyle = null,
  onClearStyle,
  activePersona = null,
  onClearPersona,
  hasSelection = false,
  selectedText = null,
  isGuest = false
}: ComposeBarProps) {
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const historyPopupRef = useRef<HTMLDivElement>(null);
  const sendButtonRef = useRef<HTMLButtonElement>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? internalTextareaRef;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [promptHistory, setPromptHistory] = useState<PromptHistoryEntry[]>([]);
  
  const rewriteExamples = useMemo(
    () => [
      "Make it more concise",
      "Add more detail and examples",
      "Change tone to formal",
      "Make it more conversational",
      "Simplify the language"
    ],
    []
  );

  const writeExamples = useMemo(
    () => [
      "Write a blog post about...",
      "Create a product description for...",
      "Draft an email about...",
      "Write a social media post about...",
      "Create content about..."
    ],
    []
  );
  
  const [rewritePlaceholderIndex, setRewritePlaceholderIndex] = useState(0);
  const [writePlaceholderIndex, setWritePlaceholderIndex] = useState(0);
  const [typingChar, setTypingChar] = useState("1");
  const [isListening, setIsListening] = useState(false);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [showGuestVoiceNotice, setShowGuestVoiceNotice] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    if (hasSelection) {
      const interval = setInterval(() => {
        setRewritePlaceholderIndex((prev) => (prev + 1) % rewriteExamples.length);
      }, 4000);
      return () => clearInterval(interval);
    } else {
      const interval = setInterval(() => {
        setWritePlaceholderIndex((prev) => (prev + 1) % writeExamples.length);
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [hasSelection, rewriteExamples.length, writeExamples.length]);

  // Typing cursor animation when loading
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setTypingChar((prev) => (prev === "1" ? "0" : "1"));
    }, 200);
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const lineHeight = 24;
    const maxHeight = lineHeight * 10;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, textareaRef]);

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Speech recognition requires HTTPS (except localhost)
    const isSecureContext = window.isSecureContext || window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isSecureContext) {
      console.warn('Speech recognition requires HTTPS');
      return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      // Browser doesn't support speech recognition
      console.warn('Speech recognition not supported in this browser');
      return;
    }
    
    // Check for iOS Safari specific requirements
    const isIOSSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS|OPiOS/.test(navigator.userAgent);
    if (isIOSSafari) {
      // iOS Safari requires Siri to be enabled for speech recognition
      console.info('iOS Safari detected - Siri must be enabled for speech recognition');
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }

      // Update the textarea value with both interim and final transcripts
      const currentValue = value.trim();
      const newValue = currentValue 
        ? `${currentValue} ${finalTranscript}${interimTranscript}`.trim()
        : `${finalTranscript}${interimTranscript}`.trim();
      
      onChange(newValue);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.log('Speech recognition error:', event.error, event.message);
      setIsListening(false);
      
      // Handle different error types
      switch (event.error) {
        case 'not-allowed':
          // Speech recognition permission denied
          // Provide helpful guidance based on browser
          const userAgent = navigator.userAgent;
          const isChrome = /Chrome/.test(userAgent) && !/Edge|OPR/.test(userAgent);
          const isSafari = /Safari/.test(userAgent) && !/Chrome|Edge|CriOS|FxiOS|OPiOS/.test(userAgent);
          const isEdge = /Edge/.test(userAgent);
          const isIOSSafari = /iPhone|iPad|iPod/.test(userAgent) && isSafari;
          
          let errorMsg = 'Microphone access denied. ';
          if (isIOSSafari) {
            errorMsg += 'Make sure Siri is enabled in iOS Settings > Siri & Search, and allow microphone access when prompted.';
          } else if (isChrome) {
            errorMsg += 'Click the lock icon (🔒) in your address bar, allow microphone access, then try again.';
          } else if (isEdge) {
            errorMsg += 'Click the lock icon (🔒) in your address bar, allow microphone access, then try again.';
          } else if (isSafari) {
            errorMsg += 'Go to Safari > Settings > Websites > Microphone and allow access for this site, then refresh the page.';
          } else {
            errorMsg += 'Please allow microphone permissions in your browser settings and try again.';
          }
          setRecognitionError(errorMsg);
          break;
        case 'no-speech':
          // User stopped speaking or no speech detected - this is normal, don't show error
          setRecognitionError(null);
          break;
        case 'aborted':
          // User or system aborted - don't show error
          setRecognitionError(null);
          break;
        case 'network':
          setRecognitionError('Network error. Please check your internet connection.');
          break;
        case 'service-not-allowed':
          setRecognitionError('Speech recognition service is not allowed. Please check your browser settings.');
          break;
        default:
          // Only log unexpected errors, don't show to user unless critical
          if (event.error !== 'no-speech' && event.error !== 'aborted') {
            console.warn('Speech recognition error:', event.error);
            setRecognitionError(`Speech recognition error: ${event.error}`);
          }
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore errors when stopping
        }
      }
    };
  }, [value, onChange]);

  // Load prompt history
  useEffect(() => {
    setPromptHistory(getPromptHistory());
  }, []);

  // Close history popup when clicking outside
  useEffect(() => {
    if (!historyOpen) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      if (
        historyPopupRef.current &&
        !historyPopupRef.current.contains(event.target as Node) &&
        historyButtonRef.current &&
        !historyButtonRef.current.contains(event.target as Node)
      ) {
        setHistoryOpen(false);
      }
    };
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [historyOpen]);

  // Refresh history when it opens
  useEffect(() => {
    if (historyOpen) {
      setPromptHistory(getPromptHistory());
    }
  }, [historyOpen]);

  const handleHistorySelect = (prompt: string) => {
    onChange(prompt);
    setHistoryOpen(false);
    // Focus the textarea after selecting
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const getBrowserSupportInfo = () => {
    const userAgent = navigator.userAgent;
    const isChrome = /Chrome/.test(userAgent) && !/Edge|OPR/.test(userAgent);
    const isEdge = /Edge/.test(userAgent);
    const isSafari = /Safari/.test(userAgent) && !/Chrome|Edge|CriOS|FxiOS|OPiOS/.test(userAgent);
    const isFirefox = /Firefox/.test(userAgent);
    const isOpera = /OPR/.test(userAgent);
    const isIOSSafari = /iPhone|iPad|iPod/.test(userAgent) && isSafari;
    
    if (isChrome || isEdge || isOpera) {
      return { supported: true, message: null };
    } else if (isIOSSafari) {
      return { 
        supported: true, 
        message: 'Note: Siri must be enabled in iOS Settings for voice input to work.' 
      };
    } else if (isSafari) {
      return { supported: true, message: null };
    } else if (isFirefox) {
      return { 
        supported: false, 
        message: 'Firefox does not support voice. Use Safari, Chrome or Edge for this feature.' 
      };
    } else {
      return { 
        supported: false, 
        message: 'Voice input may not be supported in your browser. Please use Chrome, Edge, or Safari.' 
      };
    }
  };

  const toggleSpeechRecognition = () => {
    // If guest, show blue notice instead of starting recognition
    if (isGuest) {
      setShowGuestVoiceNotice(true);
      return;
    }

    if (!recognitionRef.current) {
      const supportInfo = getBrowserSupportInfo();
      const errorMessage = supportInfo.message || 'Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.';
      setRecognitionError(errorMessage);
      
      // Keep Firefox warning visible for 15 seconds, others for 7 seconds
      const isFirefox = /Firefox/.test(navigator.userAgent);
      const timeoutDuration = isFirefox ? 15000 : 7000;
      setTimeout(() => setRecognitionError(null), timeoutDuration);
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      setRecognitionError(null);
    } else {
      // Clear any previous errors
      setRecognitionError(null);
      
      // Just try to start recognition - let the browser handle permissions
      // The onerror handler will catch and display any permission issues
      try {
        console.log('Attempting to start speech recognition...');
        recognitionRef.current.start();
      } catch (error: any) {
        console.error('Error starting speech recognition:', error);
        // Handle specific errors
        if (error.name === 'InvalidStateError' || error.message?.includes('already started')) {
          // Recognition already started, try to stop and restart
          try {
            recognitionRef.current.stop();
            setTimeout(() => {
              try {
                recognitionRef.current?.start();
              } catch (retryError) {
                console.error('Error restarting speech recognition:', retryError);
                // Don't show error here - let the onerror handler deal with it
              }
            }, 100);
          } catch (stopError) {
            console.error('Error stopping speech recognition:', stopError);
          }
        } else {
          // Show a generic error for unexpected startup errors
          setRecognitionError('Unable to start voice input. Please check your microphone permissions and try again.');
          setTimeout(() => setRecognitionError(null), 5000);
        }
      }
    }
  };

  const content = (
    <div className="flex w-full flex-col gap-2 mt-[3px]">
      {(activeStyle || activePersona) && (
        <div className="flex items-center gap-2 justify-center flex-wrap">
          {activePersona && (
            <div className="inline-flex items-center gap-1.5 h-[18px] rounded-full border border-white/40 bg-white/5 px-2.5 text-xs font-semibold uppercase text-white">
              <span className="text-[8px] font-bold text-white/50 cursor-default">PERSONA</span>
              <span>{activePersona.name}</span>
              {onClearPersona && (
                <button 
                  type="button" 
                  onClick={onClearPersona} 
                  aria-label="Remove selected persona" 
                  className="text-white/80 hover:text-white transition-colors -mx-1 px-0.5"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {activeStyle && (
            <div className="inline-flex items-center gap-1.5 h-[18px] rounded-full border border-white/40 bg-white/5 px-2.5 text-xs font-semibold uppercase text-white">
              <span className="text-[8px] font-bold text-white/50 cursor-default">STYLE</span>
              <span>{activeStyle.name}</span>
              {onClearStyle && (
                <button 
                  type="button" 
                  onClick={onClearStyle} 
                  aria-label="Remove selected style" 
                  className="text-white/80 hover:text-white transition-colors -mx-1 px-0.5"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {hasSelection ? (
        <>
          <p className="text-center text-xl font-semibold text-brand-blue">
            How should I rewrite the selection?
          </p>
          {selectedText && (() => {
            const characters = selectedText.length;
            
            // Word count: split on any whitespace character (spaces, tabs, newlines, etc.)
            // First normalize all whitespace sequences to single spaces, then split
            const normalized = selectedText
              .replace(/[\s\u00A0\u2000-\u200B\u2028\u2029\u3000\uFEFF]+/g, ' ')
              .trim();
            
            const words = normalized 
              ? normalized.split(' ').filter(word => word.length > 0).length 
              : 0;
            
            return (
              <p className="text-center text-sm text-brand-muted/50">
                Selected {characters} character{characters !== 1 ? 's' : ''}, {words} word{words !== 1 ? 's' : ''}
              </p>
            );
          })()}
        </>
      ) : (
        <p className="text-center text-xl font-semibold text-white">
          What should I write?
        </p>
      )}
      {showGuestVoiceNotice && (
        <div className="mx-auto mt-2 max-w-md rounded-lg border border-brand-blue/50 bg-brand-blue/10 px-4 py-3 text-center">
          <div className="flex items-center justify-center gap-3">
            <p className="text-sm text-white">
              Register to use voice
            </p>
            <Link
              href="/membership"
              className="rounded-full bg-brand-blue px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-blue/80 transition"
              onClick={() => setShowGuestVoiceNotice(false)}
            >
              Register
            </Link>
          </div>
        </div>
      )}
      {recognitionError && (
        <div className="mx-auto mt-2 max-w-md rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-center text-sm text-red-400">
          {recognitionError}
        </div>
      )}
      <div className="relative flex w-full items-end gap-1 mt-[6px]">
        <button
          type="button"
          aria-label="Show prompt history"
          title="History"
          ref={historyButtonRef}
          onClick={() => setHistoryOpen((prev) => !prev)}
          className={cn(
            "absolute -top-8 right-0 flex items-center justify-center transition hover:text-brand-blue",
            loading && "shimmer-loading",
            historyOpen && "text-brand-blue"
          )}
          style={{ transform: 'translate(-11px, -8px)' }}
        >
          <span className="material-symbols-outlined text-xl" style={{ color: 'rgba(255, 255, 255, 0.4)' }}>history</span>
        </button>
        {historyOpen && (
          <div
            ref={historyPopupRef}
            className="absolute bottom-full right-0 mb-10 w-[400px] max-w-[calc(100vw-2rem)] max-h-[400px] overflow-y-auto rounded-2xl border border-brand-stroke/60 bg-brand-panel shadow-[0_20px_60px_rgba(0,0,0,0.45)] z-[100]"
            style={{ transform: 'translate(-11px, 0)' }}
          >
            {/* Header with icon and title */}
            <div className="flex items-center gap-2 p-4 border-b border-brand-stroke/40">
              <span className="material-symbols-outlined text-lg text-brand-muted">history</span>
              <h3 className="text-xs font-semibold text-brand-muted uppercase tracking-wider">History</h3>
            </div>
            {promptHistory.length === 0 ? (
              <div className="p-4 text-sm text-brand-muted text-center">
                No prompt history yet
              </div>
            ) : (
              <div className="p-2">
                {promptHistory.map((entry, index) => (
                  <button
                    key={`${entry.timestamp}-${index}`}
                    type="button"
                    onClick={() => handleHistorySelect(entry.prompt)}
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/5 transition text-sm text-brand-text hover:text-white break-words"
                  >
                    <p className="line-clamp-2 break-words">{entry.prompt}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className={cn(
          "flex flex-1 items-stretch overflow-hidden border bg-brand-ink transition-all",
          "rounded-[24px]",
          hasSelection
            ? "border-brand-blue/60 shadow-[0_0_20px_rgba(59,130,246,0.4)] focus-within:border-brand-blue focus-within:shadow-[0_0_25px_rgba(59,130,246,0.5)]"
            : "border-brand-stroke/80 focus-within:border-brand-blue",
          loading && "shimmer-loading"
        )}>
          <button
            type="button"
            aria-label="Open settings"
            ref={settingsButtonRef}
            onClick={() => onToggleSettings(settingsButtonRef.current?.getBoundingClientRect() ?? null)}
            className={cn(
              "relative flex w-12 items-end justify-center border-r border-brand-stroke/80 text-brand-muted transition hover:text-brand-blue self-stretch pb-3",
              loading && "shimmer-loading"
            )}
          >
            <div className="relative">
              <WrenchIcon className="h-6 w-6" />
              {hasCustomOptions && (
                <span className="absolute -top-[4px] -right-[5px] h-2 w-2 rounded-full bg-[#00f]" />
              )}
            </div>
          </button>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Shift+Enter: allow new line (default behavior)
                if (e.shiftKey && !e.metaKey && !e.ctrlKey) {
                  return;
                }
                // Enter alone, Cmd+Enter, or Ctrl+Enter: submit
                e.preventDefault();
                if (!disabled && value.trim()) {
                  onSubmit();
                }
              }
            }}
            placeholder={hasSelection ? rewriteExamples[rewritePlaceholderIndex] : writeExamples[writePlaceholderIndex]}
            className={cn(
              "flex-1 resize-none border-none bg-transparent px-4 py-3 text-base text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:outline-none",
              loading && "shimmer-loading"
            )}
            rows={1}
          />
          <button
            type="button"
            onClick={toggleSpeechRecognition}
            aria-label={isListening ? "Stop recording" : "Start voice input"}
            className={cn(
              "flex items-center justify-center px-3 text-brand-muted transition hover:text-brand-blue self-stretch",
              isListening && "text-brand-blue"
            )}
          >
            <span 
              className={cn(
                "material-symbols-outlined text-xl",
                isListening && "animate-pulse"
              )}
            >
              mic
            </span>
          </button>
        </div>
        <button
          type="button"
          ref={sendButtonRef}
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className={cn(
            "flex min-w-[120px] items-center justify-center rounded-full px-4 py-2 transition h-12",
            {
              "bg-[#111111] text-white/60": disabled || !value.trim(),
              "bg-white text-black hover:bg-gray-100": !disabled && value.trim(),
              "shimmer-loading": loading
            }
          )}
        >
          {loading ? (
            <span className={cn(
              "text-2xl font-mono",
              disabled || !value.trim() ? "text-white/60" : "text-black"
            )}>{typingChar}</span>
          ) : (
            <span className="material-symbols-sharp text-black" style={{ fontSize: '36px' }}>arrow_upward</span>
          )}
        </button>
      </div>
    </div>
  );

  if (compact) {
    return <div className="w-full">{content}</div>;
  }

  return (
    <div className="compose-bar rounded-[32px] border border-brand-stroke/60 bg-[#0a0a0a]/90 backdrop-blur-[10px] p-3">
      {content}
    </div>
  );
}

