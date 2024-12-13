import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { socket } from "@/lib/socket";

interface File {
  name: string;
  url: string;
  type: string;
}

export default function Slideshow() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timer, setTimer] = useState<NodeJS.Timeout | null>(null);

  const { data: files = [], refetch } = useQuery<File[]>({
    queryKey: ["/api/files"],
  });

  useEffect(() => {
    socket.on("filesUpdated", () => {
      refetch();
    });
    return () => {
      socket.off("filesUpdated");
    };
  }, [refetch]);

  useEffect(() => {
    if (files.length > 0) {
      showSlide(currentIndex);
    }
  }, [files, currentIndex]);

  const showSlide = (index: number) => {
    if (timer) clearTimeout(timer);
    
    // Schedule next slide
    const currentFile = files[index];
    if (currentFile.type === ".mp4") {
      const video = document.querySelector("video");
      if (video) {
        video.onended = () => {
          setCurrentIndex((prev) => (prev + 1) % files.length);
        };
      }
    } else {
      setTimer(setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % files.length);
      }, 15000));
    }
  };

  if (files.length === 0) {
    return <div className="w-screen h-screen bg-black flex items-center justify-center text-white">No content available</div>;
  }

  const currentFile = files[currentIndex];

  return (
    <div className="w-screen h-screen bg-black overflow-hidden">
      {currentFile.type === ".mp4" ? (
        <video
          key={currentFile.url}
          src={currentFile.url}
          className="w-full h-full object-contain transition-opacity duration-1000"
          autoPlay
          muted
        />
      ) : (
        <img
          key={currentFile.url}
          src={currentFile.url}
          alt={currentFile.name}
          className="w-full h-full object-contain transition-opacity duration-1000"
        />
      )}
    </div>
  );
}
