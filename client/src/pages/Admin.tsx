import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { socket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Upload, Trash2, GripVertical } from "lucide-react";
import { DragDropContext, Droppable, Draggable, DropResult } from "react-beautiful-dnd";

interface File {
  name: string;
  url: string;
  type: string;
}

export default function Admin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
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
      queryClient.invalidateQueries(["/api/files"]);
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
      queryClient.invalidateQueries(["/api/files"]);
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
      queryClient.invalidateQueries(["/api/files"]);
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

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const items = Array.from(files);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    const newOrder = items.map((item) => item.name);
    updateOrderMutation.mutate(newOrder);
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

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="files">
          {(provided) => (
            <div
              {...provided.droppableProps}
              ref={provided.innerRef}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            >
              {files.map((file, index) => (
                <Draggable key={file.name} draggableId={file.name} index={index}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className="relative group"
                    >
                      <Card className="p-4">
                        <div className="absolute top-2 left-2 opacity-50 group-hover:opacity-100 transition-opacity">
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
                            onClick={() => deleteMutation.mutate(file.name)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </Card>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
}
