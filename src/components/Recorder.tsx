"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// Renderの無料プランは15分アクセスがないとスリープするため、録音中は定期的にpingを打つ
const KEEPALIVE_INTERVAL = 10 * 60 * 1000; // 10分

type RecorderProps = {
  onRecordingComplete: (blob: Blob, startedAt: string) => void;
  onFileSelected: (file: File) => void;
  disabled: boolean;
};

export default function Recorder({ onRecordingComplete, onFileSelected, disabled }: RecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startedAtRef = useRef<string>("");
  const mimeTypeRef = useRef<string>("audio/webm");
  const onRecordingCompleteRef = useRef(onRecordingComplete);

  // Screen Wake Lock（録音中の画面スリープ抑止）
  // iPhoneの自動ロックでMediaRecorderが停止するのを防ぐ
  const requestWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => {
        // タブがバックグラウンドに行くと自動で release される。参照を外すだけ
        if (wakeLockRef.current === lock) {
          wakeLockRef.current = null;
        }
      });
      wakeLockRef.current = lock;
    } catch (err) {
      console.warn("Wake Lock取得失敗:", err);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }, []);

  // Keep callback ref up to date
  useEffect(() => {
    onRecordingCompleteRef.current = onRecordingComplete;
  }, [onRecordingComplete]);

  // アンマウント時のリソース解放（録音中に画面遷移した場合のリーク防止）
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (keepaliveTimerRef.current) clearInterval(keepaliveTimerRef.current);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // タブがフォアグラウンドに戻ったらWake Lockを再取得
  // （バックグラウンド時に自動releaseされるため）
  useEffect(() => {
    if (!isRecording) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [isRecording, requestWakeLock]);

  // ストリーム・AudioContextを片付けて、録音済みBlobをコールバックに渡す
  const finalize = useCallback(() => {
    if (audioContextRef.current) {
      audioContextRef.current.close().catch((err) =>
        console.error("AudioContext close失敗:", err)
      );
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
    chunksRef.current = [];
    onRecordingCompleteRef.current(blob, startedAtRef.current);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
      });
      streamRef.current = rawStream;

      // Web Audio APIでゲイン（音量増幅）を適用
      // Android端末はマイクゲインが低いことがあるため、ソフトウェアで増幅する
      const audioContext = new AudioContext();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(rawStream);
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 3.0; // 3倍に増幅
      // 音割れ（クリッピング）防止のためコンプレッサーを挟む
      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -6;
      compressor.knee.value = 6;
      compressor.ratio.value = 12;
      const destination = audioContext.createMediaStreamDestination();
      source.connect(gainNode);
      gainNode.connect(compressor);
      compressor.connect(destination);
      const stream = destination.stream;

      // フォーマット選択: mp4(AAC)を優先（AndroidのWebM/Opusは品質が低いため）
      mimeTypeRef.current = MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";

      chunksRef.current = [];

      const now = new Date();
      startedAtRef.current = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

      const recorder = new MediaRecorder(stream, {
        mimeType: mimeTypeRef.current,
        audioBitsPerSecond: 128000,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;

      setIsRecording(true);
      setElapsed(0);

      // 画面スリープ抑止（iPhone自動ロック対策）
      await requestWakeLock();

      // 経過時間タイマー
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);

      // キープアライブpingタイマー（Render無料プランのスリープ防止）
      // ネットワーク切断時に ping が積み上がらないよう 30秒 で abort する
      keepaliveTimerRef.current = setInterval(() => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        fetch("/api/ping", { signal: controller.signal })
          .catch((err) => {
            console.warn("キープアライブping失敗:", err);
          })
          .finally(() => clearTimeout(timeout));
      }, KEEPALIVE_INTERVAL);
    } catch (err) {
      alert("マイクへのアクセスが許可されていません。ブラウザの設定を確認してください。");
      console.error(err);
    }
  }, [requestWakeLock]);

  const stopRecording = useCallback(() => {
    // タイマーを先に止める
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }

    // Wake Lock解放（画面スリープ抑止を解除）
    releaseWakeLock();

    setIsRecording(false);

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      // レコーダー停止完了を待ってからfinalize
      recorder.onstop = () => {
        finalize();
      };
      try {
        recorder.stop();
      } catch (err) {
        // recorder.stop() が例外を投げた場合は onstop が発火しないため
        // 直接 finalize を呼んで MediaStream/AudioContext を確実に解放する
        console.error("recorder.stop失敗:", err);
        finalize();
      }
    } else {
      finalize();
    }
  }, [finalize, releaseWakeLock]);

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
