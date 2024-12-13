import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { socket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Upload, Trash2, GripVertical } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';

interface File {
  name: string;
  url: string;
  type: string;
}

function SortableItem({ file, onDelete }: { file: File; onDelete: (filename: string) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: file.name });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    transition,
  } : undefined;

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      <Card className="p-4">
        <div {...attributes} {...listeners} className="absolute top-2 left-2 opacity-50 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
          <GripVertical className="h-4 w-4" />
        </div>
        {file.type === ".mp4" ? (
          <video src={file.url} className="w-full aspect-video object-cover mb-4" />
        ) : (
          <img src={file.url} alt={file.name} className="w-full aspect-video object-cover mb-4" />
        )}
        <div className="flex items-center justify-between">
          <span className="truncate">{file.name}</span>
          <Button
            variant="destructive"
            size="icon"
            onClick={() => onDelete(file.name)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function Admin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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

  const uploadMutation = useMutation({
    mutationFn: async (file: globalThis.File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "File uploaded successfully",
      });
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

  const deleteMutation = useMutation({
    mutationFn: async (filename: string) => {
      const response = await fetch(`/api/files/${filename}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Delete failed");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "File deleted successfully",
      });
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ order: newOrder }),
      });
      if (!response.ok) throw new Error("Failed to update order");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      toast({
        title: "Success",
        description: "Order updated successfully",
      });
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
      uploadMutation.mutate(file);
    }
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    
    if (active.id !== over.id) {
      const oldIndex = files.findIndex((file) => file.name === active.id);
      const newIndex = files.findIndex((file) => file.name === over.id);
      
      if (oldIndex !== -1 && newIndex !== -1) {
        console.log('Reordenando archivos:', { oldIndex, newIndex });
        const newFiles = arrayMove(files, oldIndex, newIndex);
        const newOrder = newFiles.map((file) => file.name);
        console.log('Nuevo orden:', newOrder);
        updateOrderMutation.mutate(newOrder);
      }
    }
  };

  return (
    <div className="container mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">Slideshow Admin</h1>
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
          >
            <Upload className="mr-2 h-4 w-4" />
            Upload File
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext 
          items={files.map(file => file.name)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col space-y-4 max-w-4xl mx-auto">
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
