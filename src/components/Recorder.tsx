"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type RecorderProps = {
  onRecordingComplete: (blob: Blob) => void;
  onFileSelected: (file: File) => void;
  disabled: boolean;
};

export default function Recorder({ onRecordingComplete, onFileSelected, disabled }: RecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000 },
      });

      // Choose best supported format
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 32000,
      });

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        onRecordingComplete(blob);
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setElapsed(0);

      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert("マイクへのアクセスが許可されていません。ブラウザの設定を確認してください。");
      console.error(err);
    }
  }, [onRecordingComplete]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
      e.target.value = "";
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Recording button */}
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={disabled && !isRecording}
        className={`w-32 h-32 rounded-full flex items-center justify-center text-lg font-bold transition-all ${
          isRecording
            ? "bg-red-600 hover:bg-red-500 animate-pulse shadow-lg shadow-red-600/30"
            : "bg-blue-600 hover:bg-blue-500 disabled:opacity-50 shadow-lg shadow-blue-600/30"
        }`}
      >
        {isRecording ? "停止" : "録音"}
      </button>

      {/* Timer */}
      {isRecording && (
        <div className="text-3xl font-mono text-red-400">{formatTime(elapsed)}</div>
      )}

      {/* File upload option */}
      {!isRecording && (
        <div className="text-center">
          <p className="text-slate-500 text-sm mb-2">または</p>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm text-slate-300 disabled:opacity-50 transition-colors"
          >
            音声ファイルをアップロード
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      )}
    </div>
  );
}
