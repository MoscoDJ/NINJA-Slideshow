import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { socket } from "@/lib/socket";

interface SlideFile {
  name: string;
  url: string;
  type: string;
}

const IMAGE_DURATION = 15_000;
const FADE_DURATION = 1_000;
const LOOPS_BEFORE_RELOAD = 5;

function isVideo(type: string) {
  return type === ".mp4" || type === ".webm";
}

export default function Slideshow() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [slideKey, setSlideKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const [progress, setProgress] = useState(0);
  const loopCount = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRaf = useRef<number | null>(null);
  const slideStart = useRef(0);
  const advancing = useRef(false);

  const { data: files = [], refetch } = useQuery<SlideFile[]>({
    queryKey: ["/api/files"],
  });

  useEffect(() => {
    socket.on("filesUpdated", () => refetch());
    return () => { socket.off("filesUpdated"); };
  }, [refetch]);

  const stopProgressBar = useCallback(() => {
    if (progressRaf.current) {
      cancelAnimationFrame(progressRaf.current);
      progressRaf.current = null;
    }
  }, []);

  const startImageProgressBar = useCallback(() => {
    slideStart.current = performance.now();
    setProgress(0);
    const tick = () => {
      const elapsed = performance.now() - slideStart.current;
      const pct = Math.min((elapsed / IMAGE_DURATION) * 100, 100);
      setProgress(pct);
      if (pct < 100) progressRaf.current = requestAnimationFrame(tick);
    };
    progressRaf.current = requestAnimationFrame(tick);
  }, []);

  const goToNextSlide = useCallback(() => {
    if (advancing.current) return;
    advancing.current = true;

    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    stopProgressBar();
    setFadeOut(true);

    transitionRef.current = setTimeout(() => {
      // Pause current video but DON'T remove src (React manages it)
      const vid = videoRef.current;
      if (vid) {
        vid.onended = null;
        vid.onerror = null;
        vid.ontimeupdate = null;
        vid.pause();
      }

      setCurrentIndex((prev) => {
        const next = (prev + 1) % files.length;
        if (next === 0) {
          loopCount.current++;
          if (loopCount.current >= LOOPS_BEFORE_RELOAD) {
            window.location.reload();
          }
        }
        return next;
      });
      // Unique key forces React to create a fresh DOM element every time
      setSlideKey((k) => k + 1);
      setFadeOut(false);
      setIsLoading(true);
      setProgress(0);
      advancing.current = false;
    }, FADE_DURATION);
  }, [files.length, stopProgressBar]);

  // Attach video handlers via DOM properties (not React synthetic events)
  useEffect(() => {
    if (!files.length || isLoading) return;
    const file = files[currentIndex];

    if (isVideo(file.type)) {
      const vid = videoRef.current;
      if (vid) {
        vid.onended = () => goToNextSlide();
        vid.ontimeupdate = () => {
          if (vid.duration && isFinite(vid.duration)) {
            setProgress((vid.currentTime / vid.duration) * 100);
          }
        };
        vid.onerror = () => goToNextSlide();
      }
    } else {
      startImageProgressBar();
      timerRef.current = setTimeout(goToNextSlide, IMAGE_DURATION);
    }

    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (transitionRef.current) { clearTimeout(transitionRef.current); transitionRef.current = null; }
      stopProgressBar();
    };
  }, [currentIndex, slideKey, files.length, isLoading, goToNextSlide, startImageProgressBar, stopProgressBar]);

  useEffect(() => {
    return () => stopProgressBar();
  }, [stopProgressBar]);

  if (files.length === 0) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center text-white">
        No content available
      </div>
    );
  }

  const currentFile = files[currentIndex];
  if (!currentFile) return null;

  const opacityClass = fadeOut ? "opacity-0" : isLoading ? "opacity-0" : "opacity-100";

  return (
    <div className="w-screen h-screen bg-black overflow-hidden relative">
      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 z-50 h-[3px] bg-black/30">
        <div
          className="h-full bg-[#ec1c24]"
          style={{
            width: `${progress}%`,
            transition: isVideo(currentFile.type) ? "width 0.25s linear" : "none",
          }}
        />
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-40">
          <div className="w-16 h-16 border-4 border-[#ec1c24] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {isVideo(currentFile.type) ? (
        <video
          ref={(el) => {
            videoRef.current = el;
            // React bug #6544: muted must be set via DOM property
            if (el) el.muted = true;
          }}
          key={slideKey}
          src={currentFile.url}
          className={`w-full h-full object-contain transition-opacity duration-1000 ${opacityClass}`}
          autoPlay
          muted
          playsInline
          preload="auto"
          onLoadedData={() => setIsLoading(false)}
        />
      ) : (
        <img
          key={slideKey}
          src={currentFile.url}
          alt={currentFile.name}
          className={`w-full h-full object-contain transition-opacity duration-1000 ${opacityClass}`}
          onLoad={() => setIsLoading(false)}
        />
      )}
    </div>
  );
}
