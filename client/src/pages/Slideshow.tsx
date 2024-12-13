import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { socket } from "@/lib/socket";

interface File {
  name: string;
  url: string;
  type: string;
}

export default function Slideshow() {
  // States
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  // Query
  const { data: files = [], refetch } = useQuery<File[]>({
    queryKey: ["/api/files"],
  });

  // Socket effect
  useEffect(() => {
    socket.on("filesUpdated", () => {
      refetch();
    });
    return () => {
      socket.off("filesUpdated");
    };
  }, [refetch]);

  // Transition handlers
  const handleImageLoad = () => {
    setIsLoading(false);
  };

  const handleVideoLoad = () => {
    setIsLoading(false);
  };

  const goToNextSlide = () => {
    setFadeOut(true);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % files.length);
      setFadeOut(false);
      setIsLoading(true);
    }, 1000);
  };

  // Timer effect for automatic transitions
  useEffect(() => {
    if (!files.length) return;
    
    const currentFile = files[currentIndex];
    let timeoutId: NodeJS.Timeout | null = null;

    if (currentFile.type === ".mp4") {
      const video = document.querySelector("video");
      if (video) {
        video.onended = goToNextSlide;
      }
    } else {
      timeoutId = setTimeout(goToNextSlide, 15000);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      const video = document.querySelector("video");
      if (video) {
        video.onended = null;
      }
    };
  }, [currentIndex, files.length]);

  // Loading state
  if (files.length === 0) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center text-white">
        No content available
      </div>
    );
  }

  const currentFile = files[currentIndex];

  return (
    <div className="w-screen h-screen bg-black overflow-hidden relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
      {currentFile.type === ".mp4" ? (
        <video
          key={currentFile.url}
          src={currentFile.url}
          className={`w-full h-full object-contain transition-opacity duration-1000 ${
            fadeOut ? 'opacity-0' : 'opacity-100'
          } ${isLoading ? 'opacity-0' : ''}`}
          autoPlay
          muted
          onLoadedData={handleVideoLoad}
        />
      ) : (
        <img
          key={currentFile.url}
          src={currentFile.url}
          alt={currentFile.name}
          className={`w-full h-full object-contain transition-opacity duration-1000 ${
            fadeOut ? 'opacity-0' : 'opacity-100'
          } ${isLoading ? 'opacity-0' : ''}`}
          onLoad={handleImageLoad}
        />
      )}
    </div>
  );
}
