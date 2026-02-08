import "@/index.css";
import { mountWidget, useSendFollowUpMessage } from "skybridge/web";
import { useToolInfo } from "@/helpers";

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

interface PreviewData {
  gameId: string;
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
  const sendFollowUpMessage = useSendFollowUpMessage();

  if (!toolInfo.isSuccess) {
    return (
      <div className="flex items-center justify-center rounded-2xl min-h-[400px] bg-[#0a0a0f]">
        <div className="text-center px-4">
          <div className="loading-pulse text-[#c4a747] text-lg font-semibold mb-2">
            Création de votre histoire...
          </div>
          <div className="text-[#8a8a9a] text-sm">Génération des personnages et des décors</div>
        </div>
      </div>
    );
  }

  const previewData = (toolInfo.responseMetadata as unknown as { previewData: PreviewData }).previewData;
  const bgUrl = previewData.initialScene?.backgroundUrl;
  const gameId = previewData.gameId;

  const handleStartRequest = () => {
    sendFollowUpMessage(
      `Je suis prêt à jouer. Appelle l'outil quest-forge-game avec le gameId "${gameId}" pour démarrer l'aventure.`
    );
  };

  return (
    <div className="relative rounded-2xl min-h-[450px] w-full overflow-hidden flex flex-col">
      {/* Background from first scene */}
      {bgUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center scale-110 blur-sm"
          style={{ backgroundImage: `url(${bgUrl})` }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/90" />

      <div className="relative z-10 flex flex-col items-center justify-center flex-1 px-6 py-6 text-center">
        {/* Player Character Portrait */}
        {previewData.playerCharacter?.portraitUrl && (
          <div className="card-stagger-in mb-3">
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-2 border-[#c4a747]/60 mx-auto shadow-lg shadow-[#c4a747]/20">
              <img
                src={previewData.playerCharacter.portraitUrl}
                alt={previewData.playerCharacter.name}
                className="w-full h-full object-cover"
              />
            </div>
            <p className="text-[#c4a747] text-xs mt-2 uppercase tracking-wider text-center">
              Vous incarnez : {previewData.playerCharacter.name}
            </p>
          </div>
        )}

        {/* Title */}
        <h1 className="title-glow text-xl md:text-3xl font-bold text-[#f0e6d0] mb-2 leading-tight text-center">
          {previewData.title}
        </h1>

        {/* Genre tags */}
        <p className="text-[#c4a747] text-[10px] md:text-xs uppercase tracking-[0.3em] mb-3 opacity-80">
          {previewData.genre.join(" · ")}
        </p>

        {/* Synopsis */}
        <p className="text-[#8a8a9a] text-xs md:text-sm mb-4 max-w-md mx-auto italic text-center line-clamp-3">
          {previewData.synopsis}
        </p>

        {/* CTA Button */}
        <button
          onClick={handleStartRequest}
          className="button-pulse px-8 py-3 bg-gradient-to-r from-[#c4a747]/30 to-[#c4a747]/10 border-2 border-[#c4a747] rounded-lg text-[#f0e6d0] font-bold uppercase tracking-wider hover:bg-[#c4a747]/40 transition-all text-sm"
        >
          🎮 Commencer l&apos;Aventure
        </button>

        <p className="text-[#8a8a9a]/60 text-[10px] mt-3">
          Cliquez pour lancer le jeu
        </p>
      </div>
    </div>
  );
}

mountWidget(<QuestForgePreview />);
