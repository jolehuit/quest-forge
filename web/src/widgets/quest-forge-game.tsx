import "@/index.css";
import { useCallback, useEffect, useState } from "react";
import { mountWidget, useDisplayMode, useSendFollowUpMessage, useWidgetState } from "skybridge/web";
import { useToolInfo } from "@/helpers";

// ═══════════════════════════════════════
// TYPES - New Narrative System
// ═══════════════════════════════════════

interface Character {
  id: string;
  name: string;
  isPlayer: boolean;
  portraitUrl?: string;
  personality?: string;
}

interface SceneNarration {
  text: string;
  mood: string;
}

interface SceneCharacter {
  characterId: string;
  position: "left" | "right" | "center";
  isSpeaking: boolean;
  emotionalState: string;
}

interface SceneExit {
  id: string;
  description: string;
  prompt: string;
  icon?: string;
}

interface NarrativeScene {
  id: string;
  sequenceNumber: number;
  narration: SceneNarration;
  setting: string;
  backgroundUrl: string;
  characters: SceneCharacter[];
  playerCharacterId: string;
  situation: string;
  exits: SceneExit[];
  isEnding: boolean;
}

interface GameData {
  title: string;
  genre: string[];
  synopsis: string;
  style: string;
  playerCharacter: {
    id: string;
    name: string;
    portraitUrl?: string;
    background: string;
    motivation: string;
    innerConflict: string;
  };
  characters: Character[];
  currentScene: NarrativeScene;
  introNarration: string;
}

type Screen = "title" | "intro" | "game" | "end";

interface GameState {
  [key: string]: unknown;
  screen: Screen;
  currentScene: NarrativeScene;
  visitedSceneIds: string[];
  storyMemory: string[];
  trustLevel: number;
  sceneCount: number;
  isGeneratingScene: boolean;
  _initialized: boolean;
}

// ═══════════════════════════════════════
// MAIN WIDGET COMPONENT
// ═══════════════════════════════════════

function QuestForgeGame() {
  const toolInfo = useToolInfo<"quest-forge-game">();
  const gameData = toolInfo.responseMetadata?.gameData as GameData | undefined;
  const sendFollowUpMessage = useSendFollowUpMessage();
  const [, setDisplayMode] = useDisplayMode();

  const [gameState, setGameState] = useWidgetState<GameState>({
    screen: "title",
    currentScene: {} as NarrativeScene,
    visitedSceneIds: [],
    storyMemory: [],
    trustLevel: 5,
    sceneCount: 1,
    isGeneratingScene: false,
    _initialized: false,
  });
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Initialize game state when data is available
  useEffect(() => {
    if (gameData && !gameState._initialized) {
      setGameState({
        screen: "title",
        currentScene: gameData.currentScene,
        visitedSceneIds: [gameData.currentScene.id],
        storyMemory: [],
        trustLevel: 5,
        sceneCount: 1,
        isGeneratingScene: false,
        _initialized: true,
      });
    }
  }, [gameData, gameState._initialized, setGameState]);

  // Transition helper
  const transitionTo = useCallback(
    (screen: Screen) => {
      setIsTransitioning(true);
      setTimeout(() => {
        setGameState((prev) => ({ ...prev, screen }));
        setIsTransitioning(false);
      }, 400);
    },
    [setGameState]
  );

  // Handle scene exit choice
  const handleExitChoice = useCallback(
    async (exit: SceneExit) => {
      if (!gameState || gameState.isGeneratingScene) return;

      setGameState((prev) => ({ ...prev, isGeneratingScene: true }));

      // Send message to LLM about the choice
      sendFollowUpMessage(
        `[CHOIX: ${exit.description}]\n` +
        `Le joueur a choisi: "${exit.description}"\n` +
        `Génère la réaction des PNJs à ce choix.`
      );

      // In a full implementation, this would call quest-forge-generate-scene
      // For now, we simulate the transition
      if (gameState.currentScene.isEnding || gameState.sceneCount >= 10) {
        transitionTo("end");
      } else {
        // Simulate scene generation delay
        setTimeout(() => {
          setGameState((prev) => ({
            ...prev,
            isGeneratingScene: false,
            // In real implementation, this would be the new scene from the server
          }));
        }, 1000);
      }
    },
    [gameState, sendFollowUpMessage, transitionTo, setGameState]
  );

  // Handle start game
  const handleStart = useCallback(() => {
    setDisplayMode("fullscreen");
    transitionTo("intro");
  }, [setDisplayMode, transitionTo]);

  // Handle intro complete
  const handleIntroComplete = useCallback(() => {
    transitionTo("game");
    // Send initial scene context to LLM
    if (gameData) {
      sendFollowUpMessage(
        `[SCÈNE: ${gameData.currentScene.id}]\n` +
        `Narration: ${gameData.currentScene.narration.text}\n` +
        `Situation: ${gameData.currentScene.situation}\n` +
        `Décris l'entrée dans cette scène du point de vue des PNJs.`
      );
    }
  }, [transitionTo, gameData, sendFollowUpMessage]);

  if (!gameData || !gameState._initialized) {
    return (
      <div className="vn-widget flex items-center justify-center">
        <div className="text-[#c4a747] text-lg animate-pulse">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="vn-widget">
      {gameState.screen === "title" && (
        <TitleScreen
          gameData={gameData}
          onStart={handleStart}
          isTransitioning={isTransitioning}
        />
      )}
      {gameState.screen === "intro" && (
        <IntroScreen
          introNarration={gameData.introNarration}
          onComplete={handleIntroComplete}
          isTransitioning={isTransitioning}
        />
      )}
      {gameState.screen === "game" && (
        <GameScreen
          gameData={gameData}
          gameState={gameState}
          onExitChoice={handleExitChoice}
          isTransitioning={isTransitioning}
        />
      )}
      {gameState.screen === "end" && (
        <EndScreen
          gameData={gameData}
          gameState={gameState}
          isTransitioning={isTransitioning}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// TITLE SCREEN
// ═══════════════════════════════════════

function TitleScreen({
  gameData,
  onStart,
  isTransitioning,
}: {
  gameData: GameData;
  onStart: () => void;
  isTransitioning: boolean;
}) {
  return (
    <div className={`screen-enter w-full h-full relative overflow-hidden rounded-2xl ${isTransitioning ? "opacity-0 scale-95" : ""} transition-all duration-400`}>
      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center scale-110 blur-sm"
        style={{ backgroundImage: `url(${gameData.currentScene.backgroundUrl})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/80" />

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center p-6 text-center">
        {/* Genre Tags */}
        <div className="flex gap-2 mb-4">
          {gameData.genre.map((g) => (
            <span
              key={g}
              className="text-[10px] uppercase tracking-[0.3em] text-[#c4a747]/80 font-bold"
            >
              {g}
            </span>
          ))}
        </div>

        {/* Title */}
        <h1 className="title-glow text-4xl md:text-5xl font-bold text-[#f0e6d0] mb-4 max-w-md">
          {gameData.title}
        </h1>

        {/* Synopsis */}
        <p className="text-[#8a8a9a] italic text-sm md:text-base max-w-md mb-8 leading-relaxed">
          {gameData.synopsis}
        </p>

        {/* Player Character Portrait */}
        <div className="mb-8 relative">
          <div className="w-28 h-28 md:w-36 md:h-36 rounded-full overflow-hidden border-2 border-[#c4a747]/60 shadow-2xl">
            <img
              src={gameData.playerCharacter.portraitUrl}
              alt={gameData.playerCharacter.name}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="mt-2 text-[#c4a747] text-sm font-medium">
            {gameData.playerCharacter.name}
          </div>
        </div>

        {/* Start Button */}
        <button
          onClick={onStart}
          className="button-pulse px-8 py-3 bg-gradient-to-r from-[#c4a747]/20 to-[#c4a747]/10 border-2 border-[#c4a747]/60 rounded-lg text-[#f0e6d0] font-bold uppercase tracking-wider hover:bg-[#c4a747]/30 transition-all"
        >
          Commencer l&apos;Aventure
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// INTRO SCREEN
// ═══════════════════════════════════════

function IntroScreen({
  introNarration,
  onComplete,
  isTransitioning,
}: {
  introNarration: string;
  onComplete: () => void;
  isTransitioning: boolean;
}) {
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowText(true), 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`screen-enter w-full h-full relative overflow-hidden rounded-2xl cursor-pointer ${isTransitioning ? "opacity-0 scale-95" : ""} transition-all duration-400`}
      onClick={onComplete}
    >
      {/* Dark Background */}
      <div className="absolute inset-0 bg-[#0a0a0f]" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/60 to-black/90" />

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center p-8">
        <div
          className={`max-w-2xl text-center transition-all duration-1000 ${showText ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
        >
          <p className="text-[#f0e6d0] text-base md:text-lg leading-loose whitespace-pre-line">
            {introNarration}
          </p>
          <div className="mt-8 text-[#c4a747]/60 text-sm animate-pulse">
            Cliquez pour continuer
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// GAME SCREEN - Main Narrative Interface
// ═══════════════════════════════════════

function GameScreen({
  gameData,
  gameState,
  onExitChoice,
  isTransitioning,
}: {
  gameData: GameData;
  gameState: GameState;
  onExitChoice: (exit: SceneExit) => void;
  isTransitioning: boolean;
}) {
  const scene = gameState.currentScene;
  const playerChar = gameData.playerCharacter;
  const npcs = scene.characters.filter((c) => c.characterId !== playerChar.id);

  // Get character details
  const getCharacter = (id: string) =>
    gameData.characters.find((c) => c.id === id);

  return (
    <div
      className={`screen-enter w-full h-full relative overflow-hidden rounded-2xl ${isTransitioning ? "opacity-0 scale-95" : ""} transition-all duration-400`}
      data-llm={`Scène: ${scene.narration.text.slice(0, 100)}... | Personnages: ${npcs.map((n) => getCharacter(n.characterId)?.name).join(", ")}`}
    >
      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center scene-fade-in"
        style={{ backgroundImage: `url(${scene.backgroundUrl})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/60" />

      {/* ═══════════════════════════════════════
          TOP: NARRATION PANEL
         ═══════════════════════════════════════ */}
      <div className="absolute top-0 left-0 right-0 z-20 p-4">
        <div className="narration-panel max-w-3xl mx-auto">
          <div className="bg-black/70 backdrop-blur-sm border border-[#c4a747]/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[#c4a747] text-xs uppercase tracking-wider font-bold">
                Scène {scene.sequenceNumber}
              </span>
              <span className="text-[#8a8a9a] text-xs">•</span>
              <span className="text-[#8a8a9a] text-xs italic">{scene.narration.mood}</span>
            </div>
            <p className="text-[#f0e6d0] text-sm md:text-base leading-relaxed">
              {scene.narration.text}
            </p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════
          MIDDLE: CHARACTER PORTRAITS
         ═══════════════════════════════════════ */}
      <div className="absolute inset-0 flex items-end justify-between px-4 pb-48 pointer-events-none">
        {/* Player Character - Left */}
        <div className="character-portrait-left pointer-events-auto">
          <div className="relative">
            <div className="w-32 h-40 md:w-40 md:h-52 rounded-t-lg overflow-hidden border-2 border-[#c4a747]/40 shadow-2xl bg-black/50">
              <img
                src={playerChar.portraitUrl}
                alt={playerChar.name}
                className="w-full h-full object-cover object-top"
              />
            </div>
            <div className="absolute -bottom-6 left-0 right-0 text-center">
              <span className="text-[#c4a747] text-xs font-bold uppercase tracking-wider bg-black/70 px-2 py-1 rounded">
                {playerChar.name}
              </span>
            </div>
            {/* Active indicator */}
            <div className="absolute -top-2 -right-2 w-4 h-4 bg-[#c4a747] rounded-full animate-pulse" />
          </div>
        </div>

        {/* NPCs - Right */}
        <div className="flex gap-4 pointer-events-auto">
          {npcs.map((npc) => {
            const char = getCharacter(npc.characterId);
            if (!char) return null;
            return (
              <div key={npc.characterId} className="character-portrait-right">
                <div className="relative">
                  <div
                    className={`w-32 h-40 md:w-40 md:h-52 rounded-t-lg overflow-hidden border-2 shadow-2xl bg-black/50 transition-all duration-300 ${
                      npc.isSpeaking
                        ? "border-[#c4a747] shadow-[#c4a747]/30"
                        : "border-[#8a8a9a]/40"
                    }`}
                  >
                    <img
                      src={char.portraitUrl}
                      alt={char.name}
                      className="w-full h-full object-cover object-top"
                    />
                  </div>
                  <div className="absolute -bottom-6 left-0 right-0 text-center">
                    <span
                      className={`text-xs font-bold uppercase tracking-wider bg-black/70 px-2 py-1 rounded ${
                        npc.isSpeaking ? "text-[#c4a747]" : "text-[#8a8a9a]"
                      }`}
                    >
                      {char.name}
                    </span>
                  </div>
                  {npc.isSpeaking && (
                    <div className="absolute -top-2 -left-2 w-4 h-4 bg-[#c4a747] rounded-full animate-pulse" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════
          BOTTOM: EXIT CHOICES
         ═══════════════════════════════════════ */}
      <div className="absolute bottom-0 left-0 right-0 z-30 p-4">
        <div className="max-w-3xl mx-auto">
          {gameState.isGeneratingScene ? (
            <div className="bg-black/80 backdrop-blur-sm border border-[#c4a747]/30 rounded-lg p-4 text-center">
              <div className="text-[#c4a747] animate-pulse">
                Génération de la prochaine scène...
              </div>
            </div>
          ) : scene.isEnding ? (
            <button
              onClick={() => {/* Transition to end screen */}}
              className="w-full py-4 bg-gradient-to-r from-[#c4a747]/30 to-[#c4a747]/10 border-2 border-[#c4a747] rounded-lg text-[#f0e6d0] font-bold uppercase tracking-wider hover:bg-[#c4a747]/40 transition-all"
            >
              🏆 Terminer l&apos;Histoire
            </button>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {scene.exits.map((exit, idx) => (
                <button
                  key={exit.id}
                  onClick={() => onExitChoice(exit)}
                  className="exit-choice-btn group relative overflow-hidden bg-black/70 backdrop-blur-sm border border-[#c4a747]/40 hover:border-[#c4a747] rounded-lg p-4 text-left transition-all duration-300 hover:bg-[#c4a747]/10"
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{exit.icon || ["🔥", "🤔", "⚔️"][idx % 3]}</span>
                    <span className="text-[#f0e6d0] font-medium">{exit.description}</span>
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#c4a747]/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Scene Info Bar */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-4">
        <div className="bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 flex items-center gap-2">
          <span className="text-[#c4a747] text-xs">Confiance:</span>
          <div className="flex gap-0.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-3 rounded-sm ${
                  i < gameState.trustLevel ? "bg-[#c4a747]" : "bg-[#8a8a9a]/30"
                }`}
              />
            ))}
          </div>
        </div>
        <div className="bg-black/60 backdrop-blur-sm rounded-full px-3 py-1">
          <span className="text-[#8a8a9a] text-xs">
            Scène {gameState.sceneCount}/10
          </span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// END SCREEN
// ═══════════════════════════════════════

function EndScreen({
  gameData,
  gameState,
  isTransitioning,
}: {
  gameData: GameData;
  gameState: GameState;
  isTransitioning: boolean;
}) {
  const sendFollowUpMessage = useSendFollowUpMessage();

  useEffect(() => {
    sendFollowUpMessage(
      `L'histoire "${gameData.title}" est terminée. ` +
      `Le joueur a vécu ${gameState.sceneCount} scènes. ` +
      `Donne une conclusion narrative appropriée.`
    );
  }, [gameData.title, gameState.sceneCount, sendFollowUpMessage]);

  return (
    <div
      className={`screen-enter w-full h-full relative overflow-hidden rounded-2xl ${isTransitioning ? "opacity-0 scale-95" : ""} transition-all duration-400`}
    >
      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${gameState.currentScene.backgroundUrl})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/60" />

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center p-6 text-center">
        <h2 className="text-4xl md:text-5xl font-bold text-[#c4a747] mb-4 title-glow">
          Fin de l&apos;Aventure
        </h2>

        <p className="text-[#f0e6d0] text-lg md:text-xl mb-8 max-w-md">
          {gameData.title}
        </p>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="bg-black/60 backdrop-blur-sm rounded-lg p-4 border border-[#c4a747]/30">
            <div className="text-3xl font-bold text-[#c4a747]">{gameState.sceneCount}</div>
            <div className="text-[#8a8a9a] text-sm">Scènes vécues</div>
          </div>
          <div className="bg-black/60 backdrop-blur-sm rounded-lg p-4 border border-[#c4a747]/30">
            <div className="text-3xl font-bold text-[#c4a747]">{gameState.trustLevel}/10</div>
            <div className="text-[#8a8a9a] text-sm">Confiance finale</div>
          </div>
        </div>

        <p className="text-[#8a8a9a] text-sm italic max-w-md">
          L&apos;histoire se termine ici, mais les conséquences de vos choix perdurent...
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// MOUNT WIDGET
// ═══════════════════════════════════════

mountWidget(<QuestForgeGame />);
