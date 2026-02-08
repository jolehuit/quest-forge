import "@/index.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { mountWidget, useCallTool, useDisplayMode, useSendFollowUpMessage, useWidgetState } from "skybridge/web";
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
  icon?: string;
  nextScene: {
    setting: string;
    mood: string;
    situation: string;
    presentNPCIds: string[];
    speakingNPCId: string;
  };
}

interface PuzzleData {
  id: string;
  type: "fill_in_blank" | "lock_code" | "riddle_dialogue";
  title: string;
  description: string;
  phrase?: string; // fill_in_blank: sentence with ___
  codeLength?: number; // lock_code: 3-6
  hints: string[];
  maxAttempts: number;
  failureConsequence: "death" | "trust_loss";
  visualTheme: string;
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
  puzzle?: PuzzleData;
}

interface GameData {
  gameId: string;
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
  speakingNpcId: string;
  speakingNpcName: string;
  narrationAudioUrl?: string | null;
  musicAudioUrl?: string | null;
}

type Screen = "title" | "intro" | "game" | "puzzle" | "death" | "end";

interface GameState {
  [key: string]: unknown;
  screen: Screen;
  currentScene: NarrativeScene;
  speakingNpcName: string;
  visitedSceneIds: string[];
  storyMemory: string[];
  trustLevel: number;
  sceneCount: number;
  puzzleAttempts: number;
  currentHintIndex: number;
  _initialized: boolean;
}

// Types for useCallTool
type GenerateSceneArgs = {
  [key: string]: unknown;
  gameId: string;
  previousSceneId: string;
  exitChoiceId: string;
  storyMemory: string[];
  trustLevel: number;
  sceneCount: number;
};

interface GenerateSceneResponse {
  structuredContent: {
    scene: NarrativeScene;
    speakingNpcName: string;
    speakingNpcId: string;
    sceneCount: number;
    isEnding: boolean;
    trustLevel: number;
    narrationAudioUrl?: string | null;
    musicAudioUrl?: string | null;
  };
}

type PuzzleCheckArgs = {
  [key: string]: unknown;
  gameId: string;
  puzzleId: string;
  answer: string;
  reset?: boolean;
};

type PuzzleCheckResponse = {
  structuredContent: {
    result: "success" | "failure" | "wrong" | "reset";
    consequence?: "death" | "trust_loss";
    attemptsLeft?: number;
  };
};

// ═══════════════════════════════════════
// MAIN WIDGET COMPONENT
// ═══════════════════════════════════════

function QuestForgeGame() {
  const toolInfo = useToolInfo<"quest-forge-game">();
  const gameData = toolInfo.responseMetadata?.gameData as GameData | undefined;
  const sendFollowUpMessage = useSendFollowUpMessage();
  const [, setDisplayMode] = useDisplayMode();

  const { callToolAsync, isPending: isGeneratingScene } =
    useCallTool<GenerateSceneArgs, GenerateSceneResponse>("quest-forge-generate-scene");

  const { callToolAsync: checkPuzzle, isPending: isCheckingPuzzle } =
    useCallTool<PuzzleCheckArgs, PuzzleCheckResponse>("quest-forge-puzzle-check");

  const [gameState, setGameState] = useWidgetState<GameState>({
    screen: "title",
    currentScene: {} as NarrativeScene,
    speakingNpcName: "",
    visitedSceneIds: [],
    storyMemory: [],
    trustLevel: 5,
    sceneCount: 1,
    puzzleAttempts: 3,
    currentHintIndex: 0,
    _initialized: false,
  });
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Audio refs
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);

  // Play audio from URL (served by /audio/:id endpoint)
  const playAudio = useCallback(
    (
      url: string,
      audioRef: React.MutableRefObject<HTMLAudioElement | null>,
      options: { loop?: boolean; volume?: number }
    ) => {
      // Stop previous audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }

      const audio = new Audio(url);
      audio.loop = options.loop ?? false;
      audio.volume = isMuted ? 0 : (options.volume ?? 1);
      audioRef.current = audio;
      audio.play().catch(() => {});
    },
    [isMuted]
  );

  // Sync mute state to active audio elements
  useEffect(() => {
    if (narrationAudioRef.current) {
      narrationAudioRef.current.volume = isMuted ? 0 : 0.9;
    }
    if (musicAudioRef.current) {
      musicAudioRef.current.volume = isMuted ? 0 : 0.3;
    }
  }, [isMuted]);

  // Play initial audio from gameData
  useEffect(() => {
    if (gameData && gameState._initialized && gameState.screen === "game") {
      if (gameData.narrationAudioUrl) {
        playAudio(gameData.narrationAudioUrl, narrationAudioRef, { loop: false, volume: 0.9 });
      }
      if (gameData.musicAudioUrl) {
        playAudio(gameData.musicAudioUrl, musicAudioRef, { loop: true, volume: 0.3 });
      }
    }
    // Only trigger on first game screen entry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.screen === "game" && gameState._initialized]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (narrationAudioRef.current) {
        narrationAudioRef.current.pause();
        narrationAudioRef.current.src = "";
      }
      if (musicAudioRef.current) {
        musicAudioRef.current.pause();
        musicAudioRef.current.src = "";
      }
    };
  }, []);

  // Initialize game state when data is available
  useEffect(() => {
    if (gameData && !gameState._initialized) {
      setGameState({
        screen: "title",
        currentScene: gameData.currentScene,
        speakingNpcName: gameData.speakingNpcName ?? "",
        visitedSceneIds: [gameData.currentScene.id],
        storyMemory: [],
        trustLevel: 5,
        sceneCount: 1,
        puzzleAttempts: 3,
        currentHintIndex: 0,
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
      if (!gameData || isGeneratingScene) return;

      try {
        const result = await callToolAsync({
          gameId: gameData.gameId,
          previousSceneId: gameState.currentScene.id,
          exitChoiceId: exit.id,
          storyMemory: gameState.storyMemory,
          trustLevel: gameState.trustLevel,
          sceneCount: gameState.sceneCount,
        });

        const { scene, speakingNpcName, isEnding, trustLevel, narrationAudioUrl, musicAudioUrl } = result.structuredContent;

        // Visual transition
        setIsTransitioning(true);
        setTimeout(() => {
          if (scene.puzzle) {
            setGameState((prev) => ({
              ...prev,
              currentScene: scene,
              speakingNpcName,
              sceneCount: prev.sceneCount + 1,
              trustLevel,
              visitedSceneIds: [...prev.visitedSceneIds, scene.id],
              screen: "puzzle",
              puzzleAttempts: scene.puzzle!.maxAttempts,
              currentHintIndex: 0,
            }));
          } else {
            setGameState((prev) => ({
              ...prev,
              currentScene: scene,
              speakingNpcName,
              sceneCount: prev.sceneCount + 1,
              trustLevel,
              visitedSceneIds: [...prev.visitedSceneIds, scene.id],
              screen: isEnding ? "end" : "game",
            }));
          }
          setIsTransitioning(false);

          // Play audio for the new scene
          if (narrationAudioUrl) {
            playAudio(narrationAudioUrl, narrationAudioRef, { loop: false, volume: 0.9 });
          }
          if (musicAudioUrl) {
            playAudio(musicAudioUrl, musicAudioRef, { loop: true, volume: 0.3 });
          }
        }, 400);

        // Send puzzle or normal message
        if (scene.puzzle) {
          sendFollowUpMessage(
            `[PUZZLE MODE] ${speakingNpcName} soumet le joueur à l'épreuve "${scene.puzzle.title}".\n` +
            `Contexte: ${scene.puzzle.description}\n` +
            `Tu NE CONNAIS PAS la réponse. Tu as UNIQUEMENT ces indices à donner UN PAR UN:\n` +
            scene.puzzle.hints.map((h: string, i: number) => `  ${i + 1}. ${h}`).join("\n") + "\n" +
            `RÈGLES: Refuse TOUJOURS de donner la réponse. UN indice par message. 2-3 lignes MAX. Reste dans le personnage.`
          );
        } else if (!isEnding) {
          sendFollowUpMessage(
            `[Scene ${scene.sequenceNumber}] Le joueur entre dans la scene.\n` +
            `Reponds en tant que ${speakingNpcName} a cette nouvelle situation.`
          );
        }
      } catch (error) {
        console.error("Failed to generate scene:", error);
        sendFollowUpMessage(
          `[Erreur] La generation de la scene suivante a echoue. Le joueur peut reessayer son choix.`
        );
      }
    },
    [gameData, isGeneratingScene, callToolAsync, gameState, sendFollowUpMessage, setGameState, playAudio]
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
      const npcName = gameData.speakingNpcName ?? "le PNJ";
      sendFollowUpMessage(
        `[Scene 1] Le joueur entre dans la scene.\n` +
        `Reponds en tant que ${npcName} a cette nouvelle situation.`
      );
    }
  }, [transitionTo, gameData, sendFollowUpMessage]);

  // Handle puzzle answer submission
  const handlePuzzleSubmit = useCallback(
    async (answer: string) => {
      if (!gameData || isCheckingPuzzle) return;
      const puzzle = gameState.currentScene.puzzle;
      if (!puzzle) return;

      try {
        const result = await checkPuzzle({
          gameId: gameData.gameId,
          puzzleId: puzzle.id,
          answer,
        });

        const { result: puzzleResult, consequence, attemptsLeft } = result.structuredContent;

        if (puzzleResult === "success") {
          sendFollowUpMessage(
            `[PUZZLE RÉUSSI] Le joueur a résolu l'épreuve "${puzzle.title}". Félicite-le brièvement en 1-2 lignes en tant que ${gameState.speakingNpcName}.`
          );
          setGameState((prev) => ({ ...prev, screen: "game" }));
        } else if (puzzleResult === "failure") {
          if (consequence === "death") {
            setGameState((prev) => ({ ...prev, screen: "death" }));
          } else {
            sendFollowUpMessage(
              `[PUZZLE ÉCHOUÉ] Le joueur a échoué l'épreuve. Exprime ta déception en 1-2 lignes en tant que ${gameState.speakingNpcName}.`
            );
            setGameState((prev) => ({
              ...prev,
              screen: "game",
              trustLevel: Math.max(1, prev.trustLevel - 3),
            }));
          }
        } else if (puzzleResult === "wrong") {
          setGameState((prev) => ({
            ...prev,
            puzzleAttempts: attemptsLeft ?? prev.puzzleAttempts - 1,
          }));
        }
      } catch (error) {
        console.error("Puzzle check failed:", error);
      }
    },
    [gameData, isCheckingPuzzle, checkPuzzle, gameState, sendFollowUpMessage, setGameState]
  );

  // Handle puzzle retry from death screen
  const handlePuzzleRetry = useCallback(
    async () => {
      if (!gameData) return;
      const puzzle = gameState.currentScene.puzzle;
      if (!puzzle) return;

      await checkPuzzle({
        gameId: gameData.gameId,
        puzzleId: puzzle.id,
        answer: "",
        reset: true,
      });

      setGameState((prev) => ({
        ...prev,
        screen: "puzzle",
        puzzleAttempts: puzzle.maxAttempts,
        currentHintIndex: 0,
      }));
    },
    [gameData, checkPuzzle, gameState, setGameState]
  );

  if (!gameData || !gameState._initialized) {
    return (
      <div className="vn-widget flex items-center justify-center">
        <div className="text-[#c4a747] text-lg animate-pulse">Chargement...</div>
      </div>
    );
  }

  const scene = gameState.currentScene;
  const speakingNpcName = gameState.speakingNpcName || gameData.speakingNpcName || "";

  return (
    <div
      className="vn-widget"
      data-llm={`Jeu: ${gameData.title} | Scene ${gameState.sceneCount}/6 | Lieu: ${scene.setting} | PNJ: ${speakingNpcName} | Confiance: ${gameState.trustLevel}/10`}
    >
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
          onEndStory={() => transitionTo("end")}
          isTransitioning={isTransitioning}
          isGeneratingScene={isGeneratingScene}
        />
      )}
      {gameState.screen === "puzzle" && (
        <PuzzleScreen
          gameData={gameData}
          gameState={gameState}
          onSubmitAnswer={handlePuzzleSubmit}
          isChecking={isCheckingPuzzle}
          isTransitioning={isTransitioning}
        />
      )}
      {gameState.screen === "death" && (
        <DeathScreen
          gameData={gameData}
          gameState={gameState}
          onRetry={handlePuzzleRetry}
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

      {/* Audio mute toggle - visible on game, puzzle, death, end screens */}
      {gameState.screen !== "title" && gameState.screen !== "intro" && (
        <button
          onClick={() => setIsMuted((prev) => !prev)}
          className="audio-toggle-btn"
          aria-label={isMuted ? "Unmute audio" : "Mute audio"}
          title={isMuted ? "Activer le son" : "Couper le son"}
        >
          {isMuted ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </button>
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
  onEndStory,
  isTransitioning,
  isGeneratingScene,
}: {
  gameData: GameData;
  gameState: GameState;
  onExitChoice: (exit: SceneExit) => void;
  onEndStory: () => void;
  isTransitioning: boolean;
  isGeneratingScene: boolean;
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
    >
      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center scene-fade-in"
        style={{ backgroundImage: `url(${scene.backgroundUrl})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/60" />

      {/* Loading overlay during scene generation */}
      {isGeneratingScene && (
        <div className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center">
          <div className="text-[#c4a747] animate-pulse text-lg">
            La scene se transforme...
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════
          TOP: NARRATION PANEL (Compact)
         ═══════════════════════════════════════ */}
      <div className="absolute top-0 left-0 right-0 z-20 p-3">
        <div className="narration-panel max-w-3xl mx-auto">
          <div className="bg-black/70 backdrop-blur-sm border border-[#c4a747]/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[#c4a747] text-[10px] uppercase tracking-wider font-bold">
                Scene {scene.sequenceNumber}
              </span>
              <span className="text-[#8a8a9a] text-[10px]">•</span>
              <span className="text-[#8a8a9a] text-[10px] italic">{scene.narration.mood}</span>
            </div>
            <p className="text-[#f0e6d0] text-xs md:text-sm leading-relaxed line-clamp-4">
              {scene.narration.text}
            </p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════
          MIDDLE: CHARACTER PORTRAITS (Compact)
         ═══════════════════════════════════════ */}
      <div className="absolute inset-0 flex items-end justify-between px-4 pb-32 pointer-events-none">
        {/* Player Character - Left */}
        <div className="character-portrait-left pointer-events-auto">
          <div className="relative">
            <div className="w-24 h-32 md:w-28 md:h-36 rounded-t-lg overflow-hidden border-2 border-[#c4a747]/40 shadow-2xl bg-black/50">
              <img
                src={playerChar.portraitUrl}
                alt={playerChar.name}
                className="w-full h-full object-cover object-top"
              />
            </div>
            <div className="absolute -bottom-5 left-0 right-0 text-center">
              <span className="text-[#c4a747] text-[10px] font-bold uppercase tracking-wider bg-black/70 px-2 py-0.5 rounded">
                {playerChar.name}
              </span>
            </div>
            {/* Active indicator */}
            <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-[#c4a747] rounded-full animate-pulse" />
          </div>
        </div>

        {/* NPCs - Right */}
        <div className="flex gap-3 pointer-events-auto">
          {npcs.map((npc) => {
            const char = getCharacter(npc.characterId);
            if (!char) return null;
            return (
              <div key={npc.characterId} className="character-portrait-right">
                <div className="relative">
                  <div
                    className={`w-24 h-32 md:w-28 md:h-36 rounded-t-lg overflow-hidden border-2 shadow-2xl bg-black/50 transition-all duration-300 ${
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
                  <div className="absolute -bottom-5 left-0 right-0 text-center">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider bg-black/70 px-2 py-0.5 rounded ${
                        npc.isSpeaking ? "text-[#c4a747]" : "text-[#8a8a9a]"
                      }`}
                    >
                      {char.name}
                    </span>
                  </div>
                  {npc.isSpeaking && (
                    <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-[#c4a747] rounded-full animate-pulse" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════
          BOTTOM: EXIT CHOICES (Compact)
         ═══════════════════════════════════════ */}
      <div className="absolute bottom-0 left-0 right-0 z-30 p-2">
        <div className="max-w-3xl mx-auto">
          {scene.isEnding ? (
            <button
              onClick={onEndStory}
              className="w-full py-3 bg-gradient-to-r from-[#c4a747]/30 to-[#c4a747]/10 border-2 border-[#c4a747] rounded-lg text-[#f0e6d0] font-bold uppercase tracking-wider hover:bg-[#c4a747]/40 transition-all text-sm"
            >
              Terminer l&apos;Histoire
            </button>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {scene.exits.map((exit, idx) => (
                <button
                  key={exit.id}
                  onClick={() => onExitChoice(exit)}
                  disabled={isGeneratingScene}
                  className="exit-choice-btn group relative overflow-hidden bg-black/70 backdrop-blur-sm border border-[#c4a747]/40 hover:border-[#c4a747] rounded-lg p-2.5 text-left transition-all duration-300 hover:bg-[#c4a747]/10 disabled:opacity-50 disabled:pointer-events-none"
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{exit.icon || ["🔥", "🤔", "⚔️"][idx % 3]}</span>
                    <span className="text-[#f0e6d0] text-sm font-medium">{exit.description}</span>
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#c4a747]/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Scene Info Bar - Compact */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        <div className="bg-black/60 backdrop-blur-sm rounded-full px-2 py-0.5 flex items-center gap-1.5">
          <span className="text-[#c4a747] text-[10px]">Confiance:</span>
          <div className="flex gap-0.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className={`w-1 h-2 rounded-sm ${
                  i < gameState.trustLevel ? "bg-[#c4a747]" : "bg-[#8a8a9a]/30"
                }`}
              />
            ))}
          </div>
        </div>
        <div className="bg-black/60 backdrop-blur-sm rounded-full px-2 py-0.5">
          <span className="text-[#8a8a9a] text-[10px]">
            {gameState.sceneCount}/6
          </span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// PUZZLE SCREEN
// ═══════════════════════════════════════

function PuzzleScreen({
  gameData,
  gameState,
  onSubmitAnswer,
  isChecking,
  isTransitioning,
}: {
  gameData: GameData;
  gameState: GameState;
  onSubmitAnswer: (answer: string) => void;
  isChecking: boolean;
  isTransitioning: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const [codeChars, setCodeChars] = useState<string[]>([]);
  const [showWrong, setShowWrong] = useState(false);
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const puzzle = gameState.currentScene.puzzle;
  const scene = gameState.currentScene;
  const playerChar = gameData.playerCharacter;
  const npcs = scene.characters.filter((c) => c.characterId !== playerChar.id);
  const getCharacter = (id: string) => gameData.characters.find((c) => c.id === id);
  const prevAttempts = useRef(gameState.puzzleAttempts);

  // Init code chars for lock_code
  useEffect(() => {
    if (puzzle?.type === "lock_code" && puzzle.codeLength) {
      setCodeChars(Array(puzzle.codeLength).fill(""));
      codeInputRefs.current = Array(puzzle.codeLength).fill(null);
    }
  }, [puzzle?.type, puzzle?.codeLength]);

  useEffect(() => {
    if (gameState.puzzleAttempts < prevAttempts.current) {
      setShowWrong(true);
      setTimeout(() => setShowWrong(false), 600);
      setAnswer("");
      if (puzzle?.type === "lock_code" && puzzle.codeLength) {
        setCodeChars(Array(puzzle.codeLength).fill(""));
      }
    }
    prevAttempts.current = gameState.puzzleAttempts;
  }, [gameState.puzzleAttempts, puzzle?.type, puzzle?.codeLength]);

  if (!puzzle) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (puzzle.type === "lock_code") {
      const code = codeChars.join("");
      if (code.length === (puzzle.codeLength ?? 4) && !isChecking) {
        onSubmitAnswer(code);
      }
    } else {
      if (answer.trim() && !isChecking) {
        onSubmitAnswer(answer.trim());
      }
    }
  };

  const handleCodeChar = (index: number, value: string) => {
    const char = value.slice(-1).toUpperCase();
    const newChars = [...codeChars];
    newChars[index] = char;
    setCodeChars(newChars);
    // Auto-focus next
    if (char && index < (puzzle.codeLength ?? 4) - 1) {
      codeInputRefs.current[index + 1]?.focus();
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !codeChars[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
  };

  // Visual theme
  const themeClasses: Record<string, string> = {
    ancient_runes: "border-amber-500/50",
    locked_door: "border-stone-400/50",
    magic_mirror: "border-purple-400/50",
    shadow_trial: "border-red-500/50",
    potion_choice: "border-emerald-400/50",
  };
  const themeBorder = themeClasses[puzzle.visualTheme] || "border-[#c4a747]/50";

  const themeIcons: Record<string, string> = {
    ancient_runes: "🔮",
    locked_door: "🔒",
    magic_mirror: "🪞",
    shadow_trial: "👁",
    potion_choice: "🧪",
  };
  const themeIcon = themeIcons[puzzle.visualTheme] || "⚠";

  // Render puzzle-specific input
  const renderPuzzleInput = () => {
    switch (puzzle.type) {
      case "fill_in_blank": {
        const parts = (puzzle.phrase ?? "___").split("___");
        return (
          <div className="mb-4">
            <div className="text-[#f0e6d0] text-sm leading-relaxed flex flex-wrap items-center gap-1 justify-center italic">
              <span>&quot;</span>
              {parts.map((part, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <span>{part}</span>
                  {i < parts.length - 1 && (
                    <input
                      type="text"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="??????"
                      disabled={isChecking}
                      className="fill-blank-input w-28 md:w-36 bg-transparent border-b-2 border-[#c4a747]/60 text-[#c4a747] text-center text-sm font-bold focus:outline-none focus:border-[#c4a747] placeholder-[#c4a747]/30 mx-1"
                    />
                  )}
                </span>
              ))}
              <span>&quot;</span>
            </div>
          </div>
        );
      }
      case "lock_code": {
        const len = puzzle.codeLength ?? 4;
        return (
          <div className="mb-4 flex flex-col items-center gap-3">
            <div className="flex gap-2 justify-center">
              {Array.from({ length: len }).map((_, i) => (
                <input
                  key={i}
                  ref={el => { codeInputRefs.current[i] = el; }}
                  type="text"
                  value={codeChars[i] ?? ""}
                  onChange={(e) => handleCodeChar(i, e.target.value)}
                  onKeyDown={(e) => handleCodeKeyDown(i, e)}
                  maxLength={1}
                  disabled={isChecking}
                  className="lock-code-slot w-12 h-14 md:w-14 md:h-16 bg-black/60 border-2 border-[#c4a747]/40 rounded-lg text-[#c4a747] text-xl md:text-2xl font-bold text-center focus:outline-none focus:border-[#c4a747] focus:shadow-[0_0_15px_rgba(196,167,71,0.3)] transition-all"
                />
              ))}
            </div>
          </div>
        );
      }
      case "riddle_dialogue":
      default:
        return (
          <div className="mb-4">
            <p className="text-[#f0e6d0] text-sm leading-relaxed italic text-center mb-3">
              &quot;{puzzle.description}&quot;
            </p>
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Votre réponse..."
              disabled={isChecking}
              className="puzzle-input w-full bg-black/60 border border-[#c4a747]/30 rounded-lg px-3 py-2 text-[#f0e6d0] text-sm placeholder-[#8a8a9a]/50 focus:outline-none focus:border-[#c4a747] transition-colors"
            />
          </div>
        );
    }
  };

  const isSubmitDisabled = () => {
    if (isChecking) return true;
    if (puzzle.type === "lock_code") {
      return codeChars.some(c => !c);
    }
    return !answer.trim();
  };

  return (
    <div className={`screen-enter w-full h-full relative overflow-hidden rounded-2xl ${isTransitioning ? "opacity-0 scale-95" : ""} transition-all duration-400`}>
      {/* Background */}
      <div className="absolute inset-0 bg-cover bg-center scene-fade-in" style={{ backgroundImage: `url(${scene.backgroundUrl})` }} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/70 to-black/60" />

      {/* Characters */}
      <div className="absolute inset-0 flex items-end justify-between px-4 pb-52 pointer-events-none">
        <div className="character-portrait-left pointer-events-auto">
          <div className="relative">
            <div className="w-24 h-32 md:w-28 md:h-36 rounded-t-lg overflow-hidden border-2 border-[#c4a747]/40 shadow-2xl bg-black/50">
              <img src={playerChar.portraitUrl} alt={playerChar.name} className="w-full h-full object-cover object-top" />
            </div>
            <div className="absolute -bottom-5 left-0 right-0 text-center">
              <span className="text-[#c4a747] text-[10px] font-bold uppercase tracking-wider bg-black/70 px-2 py-0.5 rounded">{playerChar.name}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-3 pointer-events-auto">
          {npcs.map((npc) => {
            const char = getCharacter(npc.characterId);
            if (!char) return null;
            return (
              <div key={npc.characterId} className="character-portrait-right">
                <div className="relative">
                  <div className={`w-24 h-32 md:w-28 md:h-36 rounded-t-lg overflow-hidden border-2 shadow-2xl bg-black/50 ${npc.isSpeaking ? "border-[#c4a747] shadow-[#c4a747]/30" : "border-[#8a8a9a]/40"}`}>
                    <img src={char.portraitUrl} alt={char.name} className="w-full h-full object-cover object-top" />
                  </div>
                  <div className="absolute -bottom-5 left-0 right-0 text-center">
                    <span className={`text-[10px] font-bold uppercase tracking-wider bg-black/70 px-2 py-0.5 rounded ${npc.isSpeaking ? "text-[#c4a747]" : "text-[#8a8a9a]"}`}>{char.name}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Puzzle Panel */}
      <div className="absolute bottom-0 left-0 right-0 z-30 p-3">
        <form onSubmit={handleSubmit} className={`puzzle-panel max-w-2xl mx-auto bg-black/85 backdrop-blur-sm border-2 ${themeBorder} rounded-xl p-4 ${showWrong ? "shake-animation" : ""}`}>
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">{themeIcon}</span>
              <span className="text-[#c4a747] text-xs uppercase tracking-wider font-bold">Épreuve</span>
              <span className="text-[#f0e6d0] text-sm font-bold">{puzzle.title}</span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: puzzle.maxAttempts }).map((_, i) => (
                <span key={i} className={`text-sm transition-all duration-300 ${i < gameState.puzzleAttempts ? "text-red-500 scale-100" : "text-[#8a8a9a]/30 scale-75"}`}>
                  ♥
                </span>
              ))}
            </div>
          </div>

          {/* Context text for fill_in_blank and lock_code */}
          {puzzle.type !== "riddle_dialogue" && (
            <p className="text-[#8a8a9a] text-xs leading-relaxed mb-3 text-center">
              {puzzle.description}
            </p>
          )}

          {/* Puzzle-specific input */}
          {renderPuzzleInput()}

          {/* Submit button */}
          <div className="flex items-center justify-between">
            <p className="text-[#8a8a9a] text-[10px] italic flex-1">
              Parlez au PNJ dans le chat pour obtenir des indices
            </p>
            <button
              type="submit"
              disabled={isSubmitDisabled()}
              className="px-5 py-2 bg-[#c4a747]/20 border border-[#c4a747]/60 rounded-lg text-[#f0e6d0] text-sm font-bold uppercase tracking-wider hover:bg-[#c4a747]/30 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              {isChecking ? "..." : "Valider"}
            </button>
          </div>
        </form>
      </div>

      {/* Scene Info Bar */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        <div className="bg-black/60 backdrop-blur-sm rounded-full px-2 py-0.5 flex items-center gap-1.5">
          <span className="text-[#c4a747] text-[10px]">Confiance:</span>
          <div className="flex gap-0.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className={`w-1 h-2 rounded-sm ${i < gameState.trustLevel ? "bg-[#c4a747]" : "bg-[#8a8a9a]/30"}`} />
            ))}
          </div>
        </div>
        <div className="bg-black/60 backdrop-blur-sm rounded-full px-2 py-0.5">
          <span className="text-[#8a8a9a] text-[10px]">{gameState.sceneCount}/6</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// DEATH SCREEN
// ═══════════════════════════════════════

function DeathScreen({
  gameData: _gameData,
  gameState,
  onRetry,
  isTransitioning,
}: {
  gameData: GameData;
  gameState: GameState;
  onRetry: () => void;
  isTransitioning: boolean;
}) {
  void _gameData;
  const scene = gameState.currentScene;
  const puzzle = scene.puzzle;

  return (
    <div className={`death-screen screen-enter w-full h-full relative overflow-hidden rounded-2xl ${isTransitioning ? "opacity-0 scale-95" : ""} transition-all duration-400`}>
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${scene.backgroundUrl})` }} />
      <div className="absolute inset-0 bg-gradient-to-t from-red-950/95 via-black/90 to-black/80" />

      <div className="relative z-10 h-full flex flex-col items-center justify-center p-6 text-center">
        <div className="text-6xl mb-4">☠️</div>
        <h2 className="text-3xl md:text-4xl font-bold text-red-400 mb-4">
          Vous avez échoué
        </h2>
        <p className="text-[#f0e6d0] text-sm md:text-base mb-2 max-w-md italic">
          {puzzle ? `L'épreuve "${puzzle.title}" vous a été fatale.` : "L'aventure s'arrête ici."}
        </p>
        <p className="text-[#8a8a9a] text-xs mb-8 max-w-md">
          Les ténèbres vous engloutissent... mais peut-être qu&apos;une autre tentative changera votre destin.
        </p>

        <button
          onClick={onRetry}
          className="px-8 py-3 bg-gradient-to-r from-red-900/40 to-red-800/20 border-2 border-red-400/60 rounded-lg text-[#f0e6d0] font-bold uppercase tracking-wider hover:bg-red-800/40 transition-all"
        >
          ↻ Retenter l&apos;épreuve
        </button>
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
    const npcName = gameState.speakingNpcName || "le narrateur";
    sendFollowUpMessage(
      `L'histoire "${gameData.title}" est terminee apres ${gameState.sceneCount} scenes. ` +
      `Donne une conclusion narrative en tant que ${npcName}.`
    );
  }, [gameData.title, gameState.sceneCount, gameState.speakingNpcName, sendFollowUpMessage]);

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
            <div className="text-[#8a8a9a] text-sm">Scenes vecues</div>
          </div>
          <div className="bg-black/60 backdrop-blur-sm rounded-lg p-4 border border-[#c4a747]/30">
            <div className="text-3xl font-bold text-[#c4a747]">{gameState.trustLevel}/10</div>
            <div className="text-[#8a8a9a] text-sm">Confiance finale</div>
          </div>
        </div>

        <p className="text-[#8a8a9a] text-sm italic max-w-md">
          L&apos;histoire se termine ici, mais les consequences de vos choix perdurent...
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// MOUNT WIDGET
// ═══════════════════════════════════════

mountWidget(<QuestForgeGame />);
