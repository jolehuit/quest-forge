import "@/index.css";
import { useCallback, useRef, useState } from "react";
import { mountWidget, useFiles, useSendFollowUpMessage } from "skybridge/web";

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

interface UploadedImage {
  id: string;
  file: File;
  previewUrl: string; // base64 data URL
  label: string;
  downloadUrl?: string;
  uploading: boolean;
  error?: string;
}

// ═══════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════

function QuestForgeUpload() {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [dragover, setDragover] = useState(false);
  const [done, setDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { upload, getDownloadUrl } = useFiles();
  const sendFollowUpMessage = useSendFollowUpMessage();

  // Read file as base64 for preview (CSP compliant - no blob: URLs)
  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (fileArray.length === 0) return;

    // Limit to 5 total
    const remaining = 5 - images.length;
    const toAdd = fileArray.slice(0, remaining);

    // Create initial entries with uploading state
    const newImages: UploadedImage[] = await Promise.all(
      toAdd.map(async (file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: await readFileAsDataURL(file),
        label: file.name.replace(/\.[^.]+$/, "").replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ""), // Remove UUID-like filenames
        uploading: true,
      }))
    );

    setImages(prev => [...prev, ...newImages]);

    // Upload each file via Skybridge
    for (const img of newImages) {
      try {
        const fileMetadata = await upload(img.file);
        const { downloadUrl } = await getDownloadUrl(fileMetadata);
        setImages(prev =>
          prev.map(i =>
            i.id === img.id
              ? { ...i, uploading: false, downloadUrl }
              : i
          )
        );
      } catch (err) {
        setImages(prev =>
          prev.map(i =>
            i.id === img.id
              ? { ...i, uploading: false, error: err instanceof Error ? err.message : "Upload failed" }
              : i
          )
        );
      }
    }
  }, [images.length, upload, getDownloadUrl]);

  const removeImage = useCallback((id: string) => {
    setImages(prev => prev.filter(i => i.id !== id));
  }, []);

  const updateLabel = useCallback((id: string, label: string) => {
    setImages(prev => prev.map(i => (i.id === id ? { ...i, label } : i)));
  }, []);

  const handleDone = useCallback(async () => {
    const readyImages = images.filter(i => i.downloadUrl && !i.error && i.label.trim());
    if (readyImages.length === 0) return;

    const urlList = readyImages
      .map(img => `- ${img.label.trim()}: ${img.downloadUrl}`)
      .join("\n");

    sendFollowUpMessage(
      `[REFERENCE IMAGES READY]\nThe following reference images have been uploaded:\n${urlList}\n\n` +
      `Please use these URLs as referenceImageUrl for the matching characters when creating the story.`
    );

    setDone(true);
  }, [images, sendFollowUpMessage]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragover(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const anyUploading = images.some(i => i.uploading);
  const readyCount = images.filter(i => i.downloadUrl && !i.error && i.label.trim()).length;
  const hasEmptyLabels = images.some(i => i.downloadUrl && !i.error && !i.label.trim());

  // ═══════════════════════════════════════════════════════════
  // DONE STATE
  // ═══════════════════════════════════════════════════════════
  if (done) {
    return (
      <div className="w-full bg-[#0a0a0f] rounded-xl p-8 text-center">
        <div className="text-4xl mb-4 text-green-500">✓</div>
        <p className="text-[#c4a747] font-semibold text-lg">Images uploaded successfully!</p>
        <p className="text-[#8a8a9a] text-sm mt-2">
          The reference images have been sent to create your story.
        </p>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // UPLOAD UI
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="w-full bg-[#0a0a0f] rounded-xl p-6">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-[#c4a747] font-semibold text-lg">📸 Reference Images</h2>
        <p className="text-[#8a8a9a] text-sm mt-1">
          Upload photos or drawings to use as reference for character portraits (max 5).
        </p>
      </div>

      {/* Drop Zone */}
      {images.length < 5 && (
        <div
          className={`upload-zone rounded-lg p-8 text-center cursor-pointer mb-4 transition-all ${
            dragover ? "dragover border-[#c4a747] bg-[#c4a747]/10" : ""
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
          onDragLeave={() => setDragover(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="text-3xl mb-2 text-[#c4a747] opacity-60">📷</div>
          <p className="text-[#8a8a9a] text-sm">Drop images here or click to browse</p>
          <p className="text-[#8a8a9a] text-xs mt-1 opacity-60">{images.length}/5 images</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {/* Image Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          {images.map((img) => (
            <div
              key={img.id}
              className="relative rounded-lg overflow-hidden border border-[rgba(196,167,71,0.2)] bg-[#12121a]"
            >
              {/* Thumbnail */}
              <div className="relative aspect-[3/4]">
                <img
                  src={img.previewUrl}
                  alt={img.label}
                  className="w-full h-full object-cover"
                />
                {/* Remove button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeImage(img.id);
                  }}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs flex items-center justify-center hover:bg-red-600/80 transition-colors cursor-pointer"
                >
                  ✕
                </button>
                {/* Status overlay */}
                {img.uploading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-[#c4a747] border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {img.error && (
                  <div className="absolute inset-0 bg-red-900/50 flex items-center justify-center">
                    <span className="text-red-300 text-xs px-2 text-center">{img.error}</span>
                  </div>
                )}
                {!img.uploading && !img.error && img.downloadUrl && (
                  <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-green-600/80 text-white text-xs flex items-center justify-center">
                    ✓
                  </div>
                )}
              </div>
              {/* Label input */}
              <input
                type="text"
                value={img.label}
                onChange={(e) => updateLabel(img.id, e.target.value)}
                placeholder="Character name..."
                className="w-full px-2 py-1.5 bg-transparent text-[#e0e0e0] text-xs border-t border-[rgba(196,167,71,0.15)] outline-none focus:border-[#c4a747] transition-colors placeholder:text-[#555]"
              />
            </div>
          ))}
        </div>
      )}

      {/* Warning for empty labels */}
      {hasEmptyLabels && (
        <p className="text-amber-400 text-xs mb-3">
          Please enter a character name for all images.
        </p>
      )}

      {/* Done Button */}
      {images.length > 0 && (
        <button
          onClick={handleDone}
          disabled={anyUploading || readyCount === 0 || hasEmptyLabels}
          className="w-full py-3 rounded-lg font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          style={{
            background: anyUploading || readyCount === 0 || hasEmptyLabels
              ? "rgba(196, 167, 71, 0.2)"
              : "linear-gradient(135deg, #c4a747, #a08930)",
            color: anyUploading || readyCount === 0 || hasEmptyLabels ? "#8a8a9a" : "#0a0a0f",
            boxShadow: anyUploading || readyCount === 0 || hasEmptyLabels
              ? "none"
              : "0 0 20px rgba(196, 167, 71, 0.3)",
          }}
        >
          {anyUploading
            ? "Uploading..."
            : hasEmptyLabels
              ? "Enter character names..."
              : readyCount === 0
                ? "Upload images first..."
                : `Done (${readyCount} image${readyCount !== 1 ? "s" : ""})`}
        </button>
      )}
    </div>
  );
}

mountWidget(<QuestForgeUpload />);
