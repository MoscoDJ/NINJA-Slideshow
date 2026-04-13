import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { socket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Trash2,
  GripVertical,
  LogOut,
  X,
  Loader2,
  Info,
  Image,
  Film,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSwappingStrategy,
} from "@dnd-kit/sortable";
import Login from "./Login";

interface SlideFile {
  name: string;
  url: string;
  type: string;
}

const MULTIPART_THRESHOLD = 100 * 1024 * 1024;
const PART_SIZE = 10 * 1024 * 1024;
const MAX_CONCURRENT_PARTS = 4;

function SortableItem({
  file,
  onDelete,
  deleting,
}: {
  file: SlideFile;
  onDelete: (filename: string) => void;
  deleting: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: file.name });

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    touchAction: "none",
    position: "relative" as const,
    zIndex: transform ? 1 : "auto",
  };

  const isVideo = file.type === ".mp4" || file.type === ".webm";

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="group overflow-hidden bg-neutral-900 border-neutral-800 hover:border-[#ec1c24]/40 transition-colors">
        <div className="relative">
          <div
            {...attributes}
            {...listeners}
            className="absolute inset-0 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing bg-black/30"
          >
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <GripVertical className="h-8 w-8 text-white drop-shadow-lg" />
            </div>
          </div>
          {isVideo ? (
            <video
              src={file.url}
              className="w-full h-36 object-cover"
            />
          ) : (
            <img
              src={file.url}
              alt={file.name}
              className="w-full h-36 object-cover"
            />
          )}
          <div className="absolute top-2 left-2 z-20">
            <span className="inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80 uppercase tracking-wider">
              {isVideo ? <Film className="h-3 w-3" /> : <Image className="h-3 w-3" />}
              {file.type.replace(".", "")}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-sm text-neutral-300 truncate flex-1">
            {file.name}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 relative z-30 text-neutral-500 hover:text-[#ec1c24] hover:bg-[#ec1c24]/10"
            onClick={() => onDelete(file.name)}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// --- Auth wrapper ---

export default function Admin() {
  const {
    data: authData,
    isLoading: authLoading,
    refetch: refetchAuth,
  } = useQuery<{ authenticated: boolean }>({
    queryKey: ["/api/auth/status"],
    staleTime: 0,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black gap-4">
        <img
          src="/logo.png"
          alt="NINJA"
          className="h-16 w-auto opacity-60"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <Loader2 className="h-8 w-8 animate-spin text-[#ec1c24]" />
      </div>
    );
  }

  if (!authData?.authenticated) {
    return <Login onSuccess={() => refetchAuth()} />;
  }

  return <AdminPanel />;
}

// --- API helper ---

async function apiJson(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// --- Admin Panel ---

function AdminPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadFileName, setUploadFileName] = useState("");
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const {
    data: files = [],
    refetch,
    isLoading: filesLoading,
  } = useQuery<SlideFile[]>({
    queryKey: ["/api/files"],
  });

  useEffect(() => {
    socket.on("filesUpdated", () => refetch());
    return () => { socket.off("filesUpdated"); };
  }, [refetch]);

  // --- Upload logic ---

  const uploadFile = useCallback(
    async (file: File) => {
      const abort = new AbortController();
      abortRef.current = abort;
      setUploadFileName(file.name);
      setUploadProgress(0);

      try {
        if (file.size < MULTIPART_THRESHOLD) {
          const { url, key } = await apiJson("/api/upload/presign", {
            filename: file.name,
            contentType: file.type,
          });

          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", url);
            xhr.setRequestHeader("Content-Type", file.type);
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable)
                setUploadProgress(Math.round((e.loaded / e.total) * 100));
            };
            xhr.onload = () =>
              xhr.status >= 200 && xhr.status < 300
                ? resolve()
                : reject(new Error(`Upload failed (${xhr.status})`));
            xhr.onerror = () => reject(new Error("Network error"));
            abort.signal.addEventListener("abort", () => xhr.abort());
            xhr.send(file);
          });

          await apiJson("/api/upload/confirm", { key });
        } else {
          const { uploadId, key } = await apiJson(
            "/api/upload/init-multipart",
            { filename: file.name, contentType: file.type },
          );

          const totalParts = Math.ceil(file.size / PART_SIZE);
          const completedParts: { partNumber: number; etag: string }[] = [];
          let bytesUploaded = 0;

          const queue = Array.from({ length: totalParts }, (_, i) => i + 1);
          const workers = Array.from(
            { length: Math.min(MAX_CONCURRENT_PARTS, totalParts) },
            async () => {
              while (queue.length > 0) {
                if (abort.signal.aborted) return;
                const partNumber = queue.shift()!;
                const start = (partNumber - 1) * PART_SIZE;
                const end = Math.min(start + PART_SIZE, file.size);
                const blob = file.slice(start, end);

                const { url } = await apiJson("/api/upload/presign-part", {
                  key,
                  uploadId,
                  partNumber,
                });

                const etag = await new Promise<string>((resolve, reject) => {
                  const xhr = new XMLHttpRequest();
                  xhr.open("PUT", url);
                  xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                      setUploadProgress(
                        Math.round(((bytesUploaded + e.loaded) / file.size) * 100),
                      );
                    }
                  };
                  xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                      resolve(xhr.getResponseHeader("ETag") || "");
                    } else {
                      reject(new Error(`Part ${partNumber} failed (${xhr.status})`));
                    }
                  };
                  xhr.onerror = () =>
                    reject(new Error(`Part ${partNumber} network error`));
                  abort.signal.addEventListener("abort", () => xhr.abort());
                  xhr.send(blob);
                });

                bytesUploaded += end - start;
                completedParts.push({ partNumber, etag });
              }
            },
          );

          await Promise.all(workers);

          if (abort.signal.aborted) {
            await apiJson("/api/upload/abort", { key, uploadId }).catch(() => {});
            return;
          }

          completedParts.sort((a, b) => a.partNumber - b.partNumber);
          await apiJson("/api/upload/complete", {
            key,
            uploadId,
            parts: completedParts,
          });
        }

        setUploadProgress(100);
        toast({ title: "Listo", description: "Archivo subido correctamente" });
        queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      } catch (err: any) {
        if (abort.signal.aborted) return;
        toast({
          title: "Error",
          description: err.message,
          variant: "destructive",
        });
      } finally {
        abortRef.current = null;
        setTimeout(() => {
          setUploadProgress(null);
          setUploadFileName("");
        }, 1500);
      }
    },
    [toast, queryClient],
  );

  const cancelUpload = () => {
    abortRef.current?.abort();
    setUploadProgress(null);
    setUploadFileName("");
    toast({ title: "Cancelado", description: "Upload cancelado" });
  };

  // --- Delete ---

  const deleteMutation = useMutation({
    mutationFn: async (filename: string) => {
      setDeletingFile(filename);
      const response = await fetch(`/api/files/${filename}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Delete failed");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Listo", description: "Archivo eliminado" });
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
    onSettled: () => setDeletingFile(null),
  });

  // --- Order ---

  const updateOrderMutation = useMutation({
    mutationFn: async (newOrder: string[]) => {
      const response = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ order: newOrder }),
      });
      if (!response.ok) throw new Error("Failed to update order");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      toast({ title: "Listo", description: "Orden actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadFile(file);
      event.target.value = "";
    }
  };

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      const oldIndex = files.findIndex((f) => f.name === active.id);
      const newIndex = files.findIndex((f) => f.name === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newFiles = arrayMove(files, oldIndex, newIndex);
        const newOrder = newFiles.map((f) => f.name);
        try {
          await updateOrderMutation.mutateAsync(newOrder);
          await queryClient.invalidateQueries({ queryKey: ["/api/files"] });
        } catch (error) {
          console.error("Error updating order:", error);
        }
      }
    }
  };

  const handleLogout = async () => {
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
  };

  const uploading = uploadProgress !== null;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-950">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="NINJA"
              className="h-10 w-auto"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-tight">
                Slideshow Admin
              </h1>
              <p className="text-xs text-neutral-500">
                {files.length} archivo{files.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-neutral-400 hover:text-white hover:bg-neutral-800"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Salir
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Instructions (shown when empty) */}
        {!filesLoading && files.length === 0 && (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-6 space-y-3">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-[#ec1c24] mt-0.5 shrink-0" />
              <div className="space-y-2 text-sm text-neutral-400">
                <p className="text-white font-medium">
                  Bienvenido al panel de administracion
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    Sube imagenes (JPEG, PNG, GIF, WebP) o videos (MP4, WebM)
                    usando el boton <strong className="text-white">Subir archivo</strong>
                  </li>
                  <li>
                    Arrastra las tarjetas para reordenar el contenido del slideshow
                  </li>
                  <li>
                    Los cambios se reflejan en tiempo real en todas las pantallas conectadas
                  </li>
                  <li>
                    Archivos de hasta 2 GB son soportados
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Actions bar */}
        <div className="flex items-center gap-4 flex-wrap">
          <input
            type="file"
            id="fileInput"
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            onClick={() => document.getElementById("fileInput")?.click()}
            disabled={uploading}
            className="bg-[#ec1c24] hover:bg-[#d01820] text-white font-medium"
          >
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Subir archivo
          </Button>

          {uploading && (
            <div className="flex-1 min-w-[200px] max-w-md space-y-1.5">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span className="truncate mr-2">{uploadFileName}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-white font-medium">{uploadProgress}%</span>
                  <button
                    onClick={cancelUpload}
                    className="text-neutral-500 hover:text-[#ec1c24] transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <Progress value={uploadProgress ?? 0} className="h-1.5" />
            </div>
          )}
        </div>

        <Separator className="bg-neutral-800" />

        {/* Files grid */}
        {filesLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[#ec1c24]" />
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={files.map((file) => file.name)}
              strategy={rectSwappingStrategy}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {files.map((file) => (
                  <SortableItem
                    key={file.name}
                    file={file}
                    onDelete={(filename) => deleteMutation.mutate(filename)}
                    deleting={deletingFile === file.name}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>
    </div>
  );
}
