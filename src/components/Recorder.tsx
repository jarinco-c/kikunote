"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const SEGMENT_DURATION = 10 * 60 * 1000; // 10 minutes per segment

type RecorderProps = {
  onRecordingComplete: (segments: Blob[], startedAt: string) => void;
  onFileSelected: (file: File) => void;
  disabled: boolean;
};

export default function Recorder({ onRecordingComplete, onFileSelected, disabled }: RecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [segmentCount, setSegmentCount] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const segmentsRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startedAtRef = useRef<string>("");
  const mimeTypeRef = useRef<string>("audio/webm");
  const onRecordingCompleteRef = useRef(onRecordingComplete);

  // Keep callback ref up to date
  useEffect(() => {
    onRecordingCompleteRef.current = onRecordingComplete;
  }, [onRecordingComplete]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (segmentTimerRef.current) clearInterval(segmentTimerRef.current);
    };
  }, []);

  // Save current chunks as a segment
  const saveCurrentChunks = useCallback(() => {
    if (chunksRef.current.length > 0) {
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
      segmentsRef.current.push(blob);
      chunksRef.current = [];
      setSegmentCount(segmentsRef.current.length);
    }
  }, []);

  // Finalize: stop stream and return all segments
  const finalize = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    onRecordingCompleteRef.current([...segmentsRef.current], startedAtRef.current);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000 },
      });
      streamRef.current = stream;

      // Choose best supported format
      mimeTypeRef.current = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";

      // Reset state
      segmentsRef.current = [];
      chunksRef.current = [];
      setSegmentCount(0);

      const now = new Date();
      startedAtRef.current = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

      // Start recorder
      const startNewRecorder = () => {
        const recorder = new MediaRecorder(stream, {
          mimeType: mimeTypeRef.current,
          audioBitsPerSecond: 32000,
        });
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.start(1000);
        mediaRecorderRef.current = recorder;
      };

      startNewRecorder();
      setIsRecording(true);
      setElapsed(0);

      // Elapsed timer
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);

      // Auto-segment timer: stop current recorder, save segment, start new one
      segmentTimerRef.current = setInterval(() => {
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state === "recording") {
          // Request final data, then stop
          recorder.requestData();
          recorder.stop();
          // Save and start new
          saveCurrentChunks();
          startNewRecorder();
        }
      }, SEGMENT_DURATION);
    } catch (err) {
      alert("マイクへのアクセスが許可されていません。ブラウザの設定を確認してください。");
      console.error(err);
    }
  }, [saveCurrentChunks]);

  const stopRecording = useCallback(() => {
    // Clear timers first
    if (segmentTimerRef.current) {
      clearInterval(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsRecording(false);

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      // Recorder is active: request final data, stop, save, finalize
      recorder.requestData();
      recorder.onstop = () => {
        saveCurrentChunks();
        finalize();
      };
      recorder.stop();
    } else {
      // Recorder already inactive: just save any remaining chunks and finalize
      saveCurrentChunks();
      finalize();
    }
  }, [saveCurrentChunks, finalize]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
      e.target.value = "";
    }
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
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
        <div className="text-center">
          <div className="text-3xl font-mono text-red-400">{formatTime(elapsed)}</div>
          {segmentCount > 0 && (
            <div className="text-xs text-slate-500 mt-1">
              {segmentCount} セグメント保存済み
            </div>
          )}
        </div>
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
