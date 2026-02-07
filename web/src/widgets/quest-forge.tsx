import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "@/helpers";

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

interface PreviewData {
  title: string;
  genre: string[];
  synopsis: string;
  playerCharacter: {
    name: string;
    portraitUrl?: string;
  };
  initialScene: {
    narration: string;
    backgroundUrl: string;
    presentNPCs: {
      id: string;
      name?: string;
      portraitUrl?: string;
    }[];
  };
}

// ═══════════════════════════════════════
// PREVIEW WIDGET
// ═══════════════════════════════════════

function QuestForgePreview() {
  const toolInfo = useToolInfo<"quest-forge">();

  if (!toolInfo.isSuccess) {
    return (
      <div className="flex items-center justify-center rounded-2xl min-h-[300px] bg-[#0a0a0f]">
        <div className="text-center">
          <div className="loading-pulse text-[#c4a747] text-lg font-semibold mb-2">
            Forging your adventure...
          </div>
          <div className="text-[#8a8a9a] text-sm">Generating artwork and preparing your story</div>
        </div>
      </div>
    );
  }

  const previewData = (toolInfo.responseMetadata as unknown as { previewData: PreviewData }).previewData;
  const bgUrl = previewData.initialScene?.backgroundUrl;

  return (
    <div className="relative rounded-2xl min-h-[300px] sm:min-h-[350px] w-full overflow-hidden">
      {/* Background from first scene */}
      {bgUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center scale-110 blur-sm"
          style={{ backgroundImage: `url(${bgUrl})` }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />

      <div className="relative z-10 flex flex-col items-center justify-center min-h-[300px] sm:min-h-[350px] px-6 py-8">
        {/* Player Character Portrait */}
        {previewData.playerCharacter?.portraitUrl && (
          <div className="card-stagger-in mb-4">
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-2 border-[#c4a747]/60 mx-auto shadow-lg shadow-[#c4a747]/20">
              <img
                src={previewData.playerCharacter.portraitUrl}
                alt={previewData.playerCharacter.name}
                className="w-full h-full object-cover"
              />
            </div>
            <p className="text-[#c4a747] text-xs mt-2 uppercase tracking-wider text-center">
              {previewData.playerCharacter.name}
            </p>
          </div>
        )}

        {/* Title */}
        <h1 className="title-glow text-2xl md:text-4xl font-bold text-[#f0e6d0] mb-2 leading-tight text-center">
          {previewData.title}
        </h1>

        {/* Genre tags */}
        <p className="text-[#c4a747] text-xs md:text-sm uppercase tracking-[0.3em] mb-3 opacity-80">
          {previewData.genre.join(" · ")}
        </p>

        {/* Synopsis */}
        <p className="text-[#8a8a9a] text-xs md:text-sm mb-6 max-w-md mx-auto italic text-center">
          {previewData.synopsis}
        </p>

        {/* Generating gameplay indicator */}
        <div className="loading-pulse text-[#c4a747] text-sm font-semibold">
          Generating gameplay...
        </div>
      </div>
    </div>
  );
}

mountWidget(<QuestForgePreview />);
