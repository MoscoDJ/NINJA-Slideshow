import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { socket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Upload, Trash2, GripVertical, LogOut, X } from "lucide-react";
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

const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100 MB
const PART_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_CONCURRENT_PARTS = 4;

function SortableItem({
  file,
  onDelete,
}: {
  file: SlideFile;
  onDelete: (filename: string) => void;
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

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="p-2 hover:shadow-lg transition-shadow relative">
        <div
          {...attributes}
          {...listeners}
          className="absolute inset-0 z-10 opacity-0 hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing bg-black/5"
        >
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <GripVertical className="h-6 w-6 text-white drop-shadow" />
          </div>
        </div>
        <div className="relative z-20">
          {file.type === ".mp4" || file.type === ".webm" ? (
            <video
              src={file.url}
              className="w-full h-32 object-cover rounded-sm mb-2"
            />
          ) : (
            <img
              src={file.url}
              alt={file.name}
              className="w-full h-32 object-cover rounded-sm mb-2"
            />
          )}
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-sm truncate flex-1">{file.name}</span>
            <Button
              variant="destructive"
              size="icon"
              className="h-7 w-7 relative z-30"
              onClick={() => onDelete(file.name)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

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
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authData?.authenticated) {
    return <Login onSuccess={() => refetchAuth()} />;
  }

  return <AdminPanel />;
}

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

function AdminPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadFileName, setUploadFileName] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const { data: files = [], refetch } = useQuery<SlideFile[]>({
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

  const uploadFile = useCallback(
    async (file: File) => {
      const abort = new AbortController();
      abortRef.current = abort;
      setUploadFileName(file.name);
      setUploadProgress(0);

      try {
        if (file.size < MULTIPART_THRESHOLD) {
          // Simple presigned PUT
          const { url, key } = await apiJson("/api/upload/presign", {
            filename: file.name,
            contentType: file.type,
          });

          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", url);
            xhr.setRequestHeader("Content-Type", file.type);

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                setUploadProgress(Math.round((e.loaded / e.total) * 100));
              }
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
          // Multipart upload
          const { uploadId, key } = await apiJson(
            "/api/upload/init-multipart",
            { filename: file.name, contentType: file.type },
          );

          const totalParts = Math.ceil(file.size / PART_SIZE);
          const completedParts: { partNumber: number; etag: string }[] = [];
          let bytesUploaded = 0;

          // Upload parts with bounded concurrency
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
                      const partBytes = bytesUploaded + e.loaded;
                      setUploadProgress(
                        Math.round((partBytes / file.size) * 100),
                      );
                    }
                  };
                  xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                      const raw = xhr.getResponseHeader("ETag");
                      resolve(raw || "");
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
            await apiJson("/api/upload/abort", { key, uploadId }).catch(
              () => {},
            );
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
        toast({ title: "Éxito", description: "Archivo subido correctamente" });
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

  const deleteMutation = useMutation({
    mutationFn: async (filename: string) => {
      const response = await fetch(`/api/files/${filename}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Delete failed");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Éxito", description: "Archivo eliminado" });
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

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
      toast({ title: "Éxito", description: "Orden actualizado" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
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
    <div className="container mx-auto p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-4xl font-bold">Slideshow Admin</h1>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </Button>
        </div>
        <div className="flex items-center gap-4">
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
          >
            <Upload className="mr-2 h-4 w-4" />
            Upload File
          </Button>
        </div>

        {uploading && (
          <div className="mt-4 max-w-md space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="truncate mr-2">{uploadFileName}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span>{uploadProgress}%</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={cancelUpload}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Progress value={uploadProgress ?? 0} />
          </div>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={files.map((file) => file.name)}
          strategy={rectSwappingStrategy}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-7xl mx-auto">
            {files.map((file) => (
              <SortableItem
                key={file.name}
                file={file}
                onDelete={(filename) => deleteMutation.mutate(filename)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
