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
// Force a full page reload every N complete loops to reclaim leaked memory.
// Critical for Smart TV browsers (webOS, Tizen) with limited heap.
const LOOPS_BEFORE_RELOAD = 5;

function isVideo(type: string) {
  return type === ".mp4" || type === ".webm";
}

/** Explicitly release a video element's media buffers. */
function releaseVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  video.onended = null;
  video.onloadeddata = null;
  video.onerror = null;
  video.pause();
  video.removeAttribute("src");
  video.load(); // forces the browser to release the media resource
}

export default function Slideshow() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const loopCount = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: files = [], refetch } = useQuery<SlideFile[]>({
    queryKey: ["/api/files"],
  });

  useEffect(() => {
    socket.on("filesUpdated", () => refetch());
    return () => { socket.off("filesUpdated"); };
  }, [refetch]);

  const goToNextSlide = useCallback(() => {
    // Clear any pending timers so we don't double-advance
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    setFadeOut(true);
    transitionRef.current = setTimeout(() => {
      // Release the outgoing video BEFORE React unmounts it
      releaseVideo(videoRef.current);
      videoRef.current = null;

      setCurrentIndex((prev) => {
        const next = (prev + 1) % files.length;
        if (next === 0) {
          loopCount.current++;
          if (loopCount.current >= LOOPS_BEFORE_RELOAD) {
            // Full reload reclaims all leaked browser memory
            window.location.reload();
          }
        }
        return next;
      });

      setFadeOut(false);
      setIsLoading(true);
    }, FADE_DURATION);
  }, [files.length]);

  // Slide timer / video-ended handler
  useEffect(() => {
    if (!files.length) return;
    const file = files[currentIndex];

    if (isVideo(file.type)) {
      const vid = videoRef.current;
      if (vid) {
        vid.onended = goToNextSlide;
      }
    } else {
      timerRef.current = setTimeout(goToNextSlide, IMAGE_DURATION);
    }

    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (transitionRef.current) { clearTimeout(transitionRef.current); transitionRef.current = null; }
    };
  }, [currentIndex, files.length, goToNextSlide]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { releaseVideo(videoRef.current); };
  }, []);

  if (files.length === 0) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center text-white">
        No content available
      </div>
    );
  }

  const currentFile = files[currentIndex];
  const opacityClass = fadeOut ? "opacity-0" : isLoading ? "opacity-0" : "opacity-100";

  return (
    <div className="w-screen h-screen bg-black overflow-hidden relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {isVideo(currentFile.type) ? (
        <video
          ref={(el) => {
            // Release the previous element if React reuses the node
            if (videoRef.current && videoRef.current !== el) {
              releaseVideo(videoRef.current);
            }
            videoRef.current = el;
          }}
          key={currentFile.url}
          src={currentFile.url}
          className={`w-full h-full object-contain transition-opacity duration-1000 ${opacityClass}`}
          autoPlay
          muted
          playsInline
          onLoadedData={() => setIsLoading(false)}
        />
      ) : (
        <img
          key={currentFile.url}
          src={currentFile.url}
          alt={currentFile.name}
          className={`w-full h-full object-contain transition-opacity duration-1000 ${opacityClass}`}
          onLoad={() => setIsLoading(false)}
        />
      )}
    </div>
  );
}
