"use client";

import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type SpeechResult = {
  isFinal: boolean;
  0?: { transcript?: string };
};

type SpeechEvent = Event & {
  resultIndex?: number;
  results: ArrayLike<SpeechResult>;
};

type SpeechErrorEvent = Event & { error?: string };

type BrowserRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechEvent) => void) | null;
  onerror: ((ev: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};

function joinText(base: string, extra: string) {
  const next = extra.replace(/\s+/g, " ").trim();
  if (!next) return base;
  if (!base) return next;
  return /\s$/.test(base) ? base + next : `${base} ${next}`;
}

function recognitionCtor(): (new () => BrowserRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => BrowserRecognition;
    webkitSpeechRecognition?: new () => BrowserRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function isAndroid() {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function voiceErrorText(code?: string) {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Разрешите микрофон для сайта в настройках браузера";
  }
  if (code === "audio-capture") return "Микрофон не найден";
  return "Голосовой ввод не запустился";
}

/** Browser speech-to-text. Audio stays on the device. */
export function VoiceInputButton({
  disabled,
  value,
  onChange,
  onError,
}: {
  disabled?: boolean;
  value: string;
  onChange: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<BrowserRecognition | null>(null);
  const committedRef = useRef("");
  const interimRef = useRef("");
  const appliedFinalsRef = useRef(0);
  const wantRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    setSupported(Boolean(recognitionCtor()));
    return () => {
      wantRef.current = false;
      recRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!disabled || !wantRef.current) return;
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
  }, [disabled]);

  function toggle() {
    if (listening) {
      wantRef.current = false;
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    onError?.("");
    // Same path as iPhone: start in this tap, one phrase, no upload.
    const mobile = isIos() || isAndroid();
    const rec = new Ctor();
    rec.lang = "ru-RU";
    rec.continuous = !mobile;
    rec.interimResults = true;
    committedRef.current = valueRef.current;
    interimRef.current = "";
    appliedFinalsRef.current = 0;
    rec.onresult = (ev) => {
      const shown = joinText(committedRef.current, interimRef.current);
      if (valueRef.current !== shown) {
        const interim = interimRef.current;
        if (interim && valueRef.current.endsWith(interim)) {
          committedRef.current = valueRef.current
            .slice(0, valueRef.current.length - interim.length)
            .replace(/\s+$/, "");
        } else {
          committedRef.current = valueRef.current;
        }
      }
      let finals = "";
      let interim = "";
      let finalCount = appliedFinalsRef.current;
      for (let i = 0; i < ev.results.length; i += 1) {
        const piece = ev.results[i];
        const text = piece?.[0]?.transcript ?? "";
        if (piece?.isFinal) {
          if (i >= appliedFinalsRef.current) finals += text;
          finalCount = i + 1;
        } else {
          interim += text;
        }
      }
      appliedFinalsRef.current = finalCount;
      if (finals) committedRef.current = joinText(committedRef.current, finals);
      interimRef.current = interim;
      onChange(joinText(committedRef.current, interim));
    };
    rec.onerror = (ev) => {
      if (ev.error === "aborted" || ev.error === "no-speech") return;
      wantRef.current = false;
      setListening(false);
      onError?.(voiceErrorText(ev.error));
    };
    rec.onend = () => {
      interimRef.current = "";
      appliedFinalsRef.current = 0;
      if (!wantRef.current || mobile) {
        wantRef.current = false;
        setListening(false);
        return;
      }
      committedRef.current = valueRef.current;
      try {
        rec.start();
      } catch {
        wantRef.current = false;
        setListening(false);
      }
    };
    recRef.current = rec;
    wantRef.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      wantRef.current = false;
      setListening(false);
      onError?.(voiceErrorText());
    }
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? "Остановить голосовой ввод" : "Голосовой ввод"}
      title={listening ? "Остановить запись" : "Сказать сообщение"}
      className={`mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${
        listening
          ? "bg-rose-500 text-white"
          : "bg-yani-soft text-yani-ink active:bg-yani-btn"
      } disabled:bg-slate-200 disabled:text-slate-400`}
    >
      {listening ? <Square size={16} /> : <Mic size={18} />}
    </button>
  );
}
