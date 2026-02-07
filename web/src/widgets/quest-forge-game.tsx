import "@/index.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { mountWidget, useDisplayMode, useSendFollowUpMessage, useWidgetState } from "skybridge/web";
import { useToolInfo } from "@/helpers";

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

const ACHIEVEMENT_TYPE_ICONS: Record<string, string> = {
  empathy: "\u{1F49B}",
  inquiry: "\u{1F50D}",
  confrontation: "\u2694\uFE0F",
  trust_build: "\u{1F91D}",
  persuasion: "\u{1F4AC}",
  deduction: "\u{1F9E9}",
  emotional_support: "\u{1FAC2}",
  boundary_respect: "\u{1F6E1}\uFE0F",
  creative_solution: "\u{1F4A1}",
  secret_discovery: "\u{1F52E}",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "border-emerald-500/50",
  medium: "border-amber-500/50",
  hard: "border-red-500/50",
  hidden: "border-purple-500/50",
};

interface AchievementTrigger {
  intent: string;
  validExamples: string[];
  antiPatterns: string[];
  evaluationInstruction: string;
}

interface SceneAchievement {
  id: string;
  name: string;
  icon: string;
  type: string;
  difficulty: string;
  required: boolean;
  choiceText: string;
  trigger: AchievementTrigger;
}

interface ExitConditions {
  requiredAchievements: string[];
  gateType: string;
  nextScene: string | Record<string, string>;
  transitionNarrative: string;
}

interface GameScene {
  id: string;
  title: string;
  act: string;
  backgroundUrl: string;
  openingLine: string;
  mood: string;
  tensionLevel: number;
  trustLevel: number;
  achievements: SceneAchievement[];
  exitConditions: ExitConditions;
}

interface GlobalAchievement {
  id: string;
  name: string;
  icon: string;
  type: string;
  description: string;
}

interface GameData {
  title: string;
  genre: string[];
  tone: string;
  synopsis: string;
  style: string;
  persona: { name: string; portraitUrl: string };
  scenes: GameScene[];
  allAchievements: GlobalAchievement[];
  introDialogue: string[];
  startSceneId: string;
}

type Screen = "title" | "intro" | "game" | "end";

interface GameState {
  [key: string]: unknown;
  screen: Screen;
  currentSceneId: string;
  unlockedAchievements: string[];
  visitedScenes: string[];
  totalChoices: number;
  introIndex: number;
  showTransition: boolean;
  transitionText: string;
}

// ═══════════════════════════════════════
// TYPEWRITER HOOK
// ═══════════════════════════════════════

function useTypewriter(text: string, speed = 35) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setDisplayed("");
    setDone(false);

    if (!text) {
      setDone(true);
      return;
    }

    let index = 0;
    timerRef.current = setInterval(() => {
      index++;
      if (index >= text.length) {
        setDisplayed(text);
        setDone(true);
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setDisplayed(text.slice(0, index));
      }
    }, speed);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [text, speed]);

  const skip = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setDisplayed(text);
    setDone(true);
  }, [text]);

  return { displayed, done, skip };
}

// ═══════════════════════════════════════
// SCREEN TRANSITION WRAPPER
// ═══════════════════════════════════════

function ScreenTransition({ screenKey, children }: { screenKey: string; children: React.ReactNode }) {
  return (
    <div key={screenKey} className="screen-enter w-full h-full">
      {children}
    </div>
  );
}

// ═══════════════════════════════════════
// DIALOGUE BOX
// ═══════════════════════════════════════

function DialogueBox({
  speaker,
  text,
  isComplete,
  onAdvance,
  onSkip,
  showContinue,
  children,
}: {
  speaker: string | null;
  text: string;
  isComplete: boolean;
  onAdvance: () => void;
  onSkip: () => void;
  showContinue: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 p-4">
      <div
        className="dialogue-box dialogue-slide-up p-4 md:p-6 mx-auto max-w-2xl cursor-pointer"
        onClick={isComplete ? onAdvance : onSkip}
      >
        {speaker && (
          <div className="text-[#c4a747] text-xs font-bold uppercase tracking-wider mb-2">{speaker}</div>
        )}
        <p className="text-[#f0e6d0] text-sm md:text-base leading-relaxed min-h-[3em]">
          {text}
          {!isComplete && <span className="cursor-blink text-[#c4a747]">{"\u258C"}</span>}
        </p>
        {isComplete && showContinue && (
          <div className="bounce-indicator text-[#c4a747] text-xs text-right mt-2 opacity-60">
            {"\u25BC"}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// ACHIEVEMENT TOAST
// ═══════════════════════════════════════

function AchievementToast({ achievement, onDone }: { achievement: GlobalAchievement; onDone: () => void }) {
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    const hideTimer = setTimeout(() => setHiding(true), 2500);
    const removeTimer = setTimeout(onDone, 3000);
    return () => {
      clearTimeout(hideTimer);
      clearTimeout(removeTimer);
    };
  }, [onDone]);

  return (
    <div
      className={`achievement-toast ${hiding ? "hiding" : ""} fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-3 rounded-lg border-2 border-[#c4a747] bg-gradient-to-r from-[#1a1025] to-[#2a1a3a]`}
    >
      <span className="text-2xl">{achievement.icon}</span>
      <div>
        <div className="text-[#c4a747] text-xs font-bold uppercase tracking-wider">Achievement Unlocked</div>
        <div className="text-[#f0e6d0] text-sm font-semibold">{achievement.name}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// SCENE INFO BAR
// ═══════════════════════════════════════

function SceneInfoBar({ scene, achievementCount, totalAchievements }: { scene: GameScene; achievementCount: number; totalAchievements: number }) {
  return (
    <div className="absolute top-0 left-0 right-0 z-20 p-3 flex items-center justify-between">
      <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 flex items-center gap-2">
        <span className="text-[#c4a747] text-xs font-bold uppercase tracking-wider">{scene.title}</span>
        <span className="text-[#8a8a9a] text-[10px]">{scene.act}</span>
      </div>
      <div className="flex items-center gap-2">
        {/* Achievement counter */}
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 flex items-center gap-1.5">
          <span className="text-[10px] text-[#c4a747]">{achievementCount}/{totalAchievements}</span>
        </div>
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 flex items-center gap-3">
          {/* Trust indicator */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[#8a8a9a]">Trust</span>
            <div className="flex gap-0.5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-1 h-1 rounded-full ${
                    i < scene.trustLevel ? "bg-[#c4a747]/80" : "bg-white/10"
                  }`}
                />
              ))}
            </div>
          </div>
          <span className="text-[10px] text-[#8a8a9a]">{scene.mood}</span>
          {/* Tension indicator dots */}
          <div className="flex gap-0.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className={`w-1 h-1 rounded-full ${
                  i < scene.tensionLevel ? "bg-red-500/80" : "bg-white/10"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// TITLE SCREEN
// ═══════════════════════════════════════

function TitleScreen({ gameData, onStart }: { gameData: GameData; onStart: () => void }) {
  const bgUrl = gameData.scenes[0]?.backgroundUrl;

  return (
    <div className="relative rounded-2xl min-h-[400px] sm:min-h-[450px] lg:min-h-[520px] w-full overflow-hidden flex flex-col items-center justify-center">
      {bgUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center scale-110 blur-sm"
          style={{ backgroundImage: `url(${bgUrl})` }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />

      <div className="relative z-10 text-center px-6">
        <h1 className="title-glow text-3xl md:text-5xl font-bold text-[#f0e6d0] mb-3 leading-tight">
          {gameData.title}
        </h1>
        <p className="text-[#c4a747] text-sm md:text-base uppercase tracking-[0.3em] mb-4 opacity-80">
          {gameData.genre.join(" \u00B7 ")}
        </p>
        <p className="text-[#8a8a9a] text-xs md:text-sm mb-10 max-w-md mx-auto italic">
          {gameData.synopsis}
        </p>

        {/* Character portrait */}
        {gameData.persona.portraitUrl && (
          <div className="card-stagger-in mb-10">
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full overflow-hidden border-2 border-[#c4a747]/60 mx-auto shadow-lg shadow-[#c4a747]/20">
              <img
                src={gameData.persona.portraitUrl}
                alt={gameData.persona.name}
                className="w-full h-full object-cover"
              />
            </div>
            <p className="text-[#c4a747] text-xs mt-2 uppercase tracking-wider">{gameData.persona.name}</p>
          </div>
        )}

        <button
          onClick={onStart}
          className="button-pulse px-10 py-4 bg-gradient-to-b from-[#2a1a3a] to-[#1a1025] border-2 border-[#c4a747] rounded-lg text-[#f0e6d0] text-lg font-semibold tracking-wider hover:border-[#e0c860] transition-colors"
        >
          BEGIN
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// INTRO SCREEN
// ═══════════════════════════════════════

function IntroScreen({ gameData, onContinue }: { gameData: GameData; onContinue: () => void }) {
  const [lineIndex, setLineIndex] = useState(0);
  const lines = gameData.introDialogue;
  const currentLine = lines[lineIndex] ?? "";
  const isLastLine = lineIndex >= lines.length - 1;
  const { displayed, done, skip } = useTypewriter(currentLine, 40);
  const bgUrl = gameData.scenes[0]?.backgroundUrl;

  const handleClick = useCallback(() => {
    if (!done) {
      skip();
      return;
    }
    if (isLastLine) {
      onContinue();
    } else {
      setLineIndex((i) => i + 1);
    }
  }, [done, skip, isLastLine, onContinue]);

  return (
    <div className="relative rounded-2xl min-h-[320px] sm:min-h-[380px] lg:min-h-[450px] w-full overflow-hidden" onClick={handleClick}>
      {bgUrl && (
        <div className="absolute inset-0 intro-bg-reveal">
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${bgUrl})` }} />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/60 to-black/90" />

      <DialogueBox
        speaker={null}
        text={displayed}
        isComplete={done}
        onAdvance={handleClick}
        onSkip={skip}
        showContinue={done && !isLastLine}
      >
        {done && isLastLine && (
          <div className="bounce-indicator text-[#c4a747] text-xs text-right mt-2 opacity-60">
            {"\u25BC"} start
          </div>
        )}
      </DialogueBox>
    </div>
  );
}

// ═══════════════════════════════════════
// GAME SCREEN
// ═══════════════════════════════════════

function checkExitConditions(exit: ExitConditions, unlocked: string[]): boolean {
  const { requiredAchievements, gateType } = exit;
  if (requiredAchievements.length === 0) return true;

  switch (gateType) {
    case "single":
    case "or_gate":
    case "branching":
      return requiredAchievements.some((id) => unlocked.includes(id));
    case "and_gate":
      return requiredAchievements.every((id) => unlocked.includes(id));
    case "cumulative":
      return requiredAchievements.filter((id) => unlocked.includes(id)).length >= Math.ceil(requiredAchievements.length / 2);
    default:
      return requiredAchievements.some((id) => unlocked.includes(id));
  }
}

function getNextSceneId(exit: ExitConditions, unlocked: string[]): string | null {
  if (typeof exit.nextScene === "string") return exit.nextScene || null;
  // Branching: find the last unlocked achievement that maps to a branch
  const branchMap = exit.nextScene as Record<string, string>;
  for (const id of [...unlocked].reverse()) {
    if (branchMap[id]) return branchMap[id];
  }
  // Fallback: first branch
  const vals = Object.values(branchMap);
  return vals[0] || null;
}

function GameScreen({
  gameData,
  gameState,
  setGameState,
  onEnd,
}: {
  gameData: GameData;
  gameState: GameState;
  setGameState: (s: GameState) => void;
  onEnd: () => void;
}) {
  const sendFollowUpMessage = useSendFollowUpMessage();
  const [toastAchievement, setToastAchievement] = useState<GlobalAchievement | null>(null);
  const [sceneKey, setSceneKey] = useState(0);
  const [hasGreetedScene, setHasGreetedScene] = useState(false);

  const scene = gameData.scenes.find((s) => s.id === gameState.currentSceneId) ?? null;

  // Available choices: achievements not yet unlocked in this scene
  const availableChoices =
    scene?.achievements.filter((a) => !gameState.unlockedAchievements.includes(a.id)) ?? [];

  // Is terminal scene? (no next scene or empty exit conditions)
  const isTerminal =
    scene &&
    (scene.exitConditions.requiredAchievements.length === 0 ||
      (!scene.exitConditions.nextScene && scene.exitConditions.requiredAchievements.length === 0));

  // Exit conditions met?
  const exitMet = scene ? checkExitConditions(scene.exitConditions, gameState.unlockedAchievements) : false;

  // Send opening greeting when entering a new scene (so LLM speaks in chat)
  useEffect(() => {
    if (!scene || hasGreetedScene) return;
    setHasGreetedScene(true);

    sendFollowUpMessage(
      `[SCENE: ${scene.id} "${scene.title}"] ` +
        `[Trust: ${scene.trustLevel}/10] ` +
        `[Mood: ${scene.mood}] ` +
        `The player has just entered this scene. Greet them in character with a short opening line.`,
    );
  }, [scene, hasGreetedScene, sendFollowUpMessage]);

  // Reset greeting flag when scene changes
  useEffect(() => {
    setHasGreetedScene(false);
  }, [sceneKey]);

  // Handle achievement choice
  const handleChoice = useCallback(
    (achievement: SceneAchievement) => {
      if (!scene) return;

      const newAchievements = [...gameState.unlockedAchievements, achievement.id];
      const newVisited = gameState.visitedScenes.includes(scene.id)
        ? gameState.visitedScenes
        : [...gameState.visitedScenes, scene.id];

      // Show toast
      const globalAch = gameData.allAchievements.find((a) => a.id === achievement.id);
      if (globalAch) setToastAchievement(globalAch);

      // Send message to LLM (no achievement details — hidden from model)
      sendFollowUpMessage(
        `[SCENE: ${scene.id} "${scene.title}"] ` +
          `[Trust: ${scene.trustLevel}/10] ` +
          `[Mood: ${scene.mood}] ` +
          `Player chose: "${achievement.choiceText}"`,
      );

      setGameState({
        ...gameState,
        unlockedAchievements: newAchievements,
        visitedScenes: newVisited,
        totalChoices: gameState.totalChoices + 1,
      });
    },
    [scene, gameData, gameState, setGameState, sendFollowUpMessage],
  );

  // Handle continue (advance to next scene)
  const handleContinue = useCallback(() => {
    if (!scene) return;

    const nextSceneId = getNextSceneId(scene.exitConditions, gameState.unlockedAchievements);

    if (!nextSceneId) {
      // Terminal — go to end
      onEnd();
      return;
    }

    // Show transition narrative
    if (scene.exitConditions.transitionNarrative) {
      setGameState({
        ...gameState,
        showTransition: true,
        transitionText: scene.exitConditions.transitionNarrative,
      });
      return;
    }

    // Direct advance
    advanceToScene(nextSceneId);
  }, [scene, gameState, setGameState, onEnd]);

  // Advance to specific scene
  const advanceToScene = useCallback(
    (sceneId: string) => {
      const nextScene = gameData.scenes.find((s) => s.id === sceneId);
      if (!nextScene) {
        onEnd();
        return;
      }

      setGameState({
        ...gameState,
        currentSceneId: sceneId,
        visitedScenes: [...new Set([...gameState.visitedScenes, sceneId])],
        showTransition: false,
        transitionText: "",
      });
      setSceneKey((k) => k + 1);

      sendFollowUpMessage(
        `[SCENE: ${sceneId} "${nextScene.title}"] ` +
          `[Trust: ${nextScene.trustLevel}/10] ` +
          `[Achievements: ${gameState.unlockedAchievements.join(", ") || "none"}] ` +
          `The player enters scene "${nextScene.title}". Narrate this transition dramatically.`,
      );
    },
    [gameData, gameState, setGameState, sendFollowUpMessage, onEnd],
  );

  if (!scene) return null;

  // ── TRANSITION NARRATIVE SCREEN ──
  if (gameState.showTransition) {
    return (
      <TransitionScreen
        text={gameState.transitionText}
        bgUrl={scene.backgroundUrl}
        onContinue={() => {
          const nextId = getNextSceneId(scene.exitConditions, gameState.unlockedAchievements);
          if (nextId) advanceToScene(nextId);
          else onEnd();
        }}
      />
    );
  }

  return (
    <div
      className="relative rounded-2xl min-h-[400px] sm:min-h-[460px] lg:min-h-[540px] w-full overflow-hidden select-none"
      data-llm={`Scene: "${scene.title}" (${scene.act}) | Mood: ${scene.mood} | Trust: ${scene.trustLevel}/10 | Achievements: ${gameState.unlockedAchievements.join(", ") || "none"} | Available choices: ${availableChoices.map(c => c.choiceText).join(", ") || "none"}`}
    >
      {/* Background */}
      <div
        key={`bg-${sceneKey}`}
        className="vn-background scene-fade-in"
        style={{ backgroundImage: `url(${scene.backgroundUrl})` }}
      />

      {/* Scene info bar */}
      <SceneInfoBar scene={scene} achievementCount={gameState.unlockedAchievements.length} totalAchievements={gameData.allAchievements.length} />

      {/* Character portrait */}
      {gameData.persona.portraitUrl && (
        <div className="absolute bottom-36 sm:bottom-40 left-4 z-10 scene-fade-in">
          <img
            src={gameData.persona.portraitUrl}
            alt={gameData.persona.name}
            className="vn-portrait w-28 h-28 md:w-36 md:h-36 object-contain"
          />
        </div>
      )}

      {/* Choices overlay */}
      <div className="absolute bottom-0 left-0 right-0 z-20 p-4">
        <div className="mx-auto max-w-2xl space-y-2">
          {/* Achievement choices */}
          {availableChoices.length > 0 &&
            availableChoices.map((ach, i) => (
              <button
                key={ach.id}
                className={`vn-choice-btn w-full text-left text-sm md:text-base flex items-center gap-3 ${DIFFICULTY_COLORS[ach.difficulty] || ""}`}
                style={{ animationDelay: `${i * 0.1}s` }}
                onClick={() => handleChoice(ach)}
              >
                <span className="text-lg shrink-0" title={ach.type}>
                  {ACHIEVEMENT_TYPE_ICONS[ach.type] || "\u2B50"}
                </span>
                <span>{ach.choiceText}</span>
                {ach.difficulty === "hidden" && (
                  <span className="ml-auto text-purple-400 text-[10px] uppercase">hidden</span>
                )}
              </button>
            ))}

          {/* Continue button (when exit conditions met) */}
          {exitMet && !isTerminal && (
            <button
              onClick={handleContinue}
              className="vn-choice-btn w-full text-center text-sm md:text-base border-[#c4a747] font-semibold"
            >
              Continue {"\u2192"}
            </button>
          )}

          {/* End button for terminal scenes */}
          {isTerminal && (
            <button
              onClick={onEnd}
              className="vn-choice-btn w-full text-center text-sm md:text-base border-[#c4a747] font-semibold"
            >
              Complete your journey
            </button>
          )}
        </div>
      </div>

      {/* Achievement toast */}
      {toastAchievement && (
        <AchievementToast achievement={toastAchievement} onDone={() => setToastAchievement(null)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// TRANSITION SCREEN
// ═══════════════════════════════════════

function TransitionScreen({
  text,
  bgUrl,
  onContinue,
}: {
  text: string;
  bgUrl: string;
  onContinue: () => void;
}) {
  const { displayed, done, skip } = useTypewriter(text, 40);

  return (
    <div
      className="relative rounded-2xl min-h-[320px] sm:min-h-[380px] lg:min-h-[450px] w-full overflow-hidden"
      onClick={done ? onContinue : skip}
      data-llm={`Player is transitioning between scenes. Transition: ${text.slice(0, 200)}`}
    >
      {bgUrl && (
        <div className="vn-background" style={{ backgroundImage: `url(${bgUrl})` }} />
      )}
      <div className="absolute inset-0 bg-black/70" />
      <DialogueBox
        speaker={null}
        text={displayed}
        isComplete={done}
        onAdvance={onContinue}
        onSkip={skip}
        showContinue={done}
      >
        {done && (
          <div className="bounce-indicator text-[#c4a747] text-xs text-right mt-2 opacity-60">
            {"\u25BC"} continue
          </div>
        )}
      </DialogueBox>
    </div>
  );
}

// ═══════════════════════════════════════
// END SCREEN
// ═══════════════════════════════════════

function EndScreen({ gameData, gameState }: { gameData: GameData; gameState: GameState }) {
  const sendFollowUpMessage = useSendFollowUpMessage();
  const [hasSentEnding, setHasSentEnding] = useState(false);

  useEffect(() => {
    if (hasSentEnding) return;
    setHasSentEnding(true);

    const earnedCount = gameState.unlockedAchievements.length;
    const totalCount = gameData.allAchievements.length;
    const scenesVisited = gameState.visitedScenes.length;
    const totalScenes = gameData.scenes.length;

    sendFollowUpMessage(
      `The player has reached the end of "${gameData.title}". ` +
        `They earned ${earnedCount}/${totalCount} achievements and visited ${scenesVisited}/${totalScenes} scenes. ` +
        `Achievements earned: ${gameState.unlockedAchievements.join(", ") || "none"}. ` +
        `Give a dramatic closing narration in character.`,
    );
  }, [hasSentEnding, gameData, gameState, sendFollowUpMessage]);

  const lastScene = gameData.scenes.find((s) => s.id === gameState.currentSceneId);
  const bgUrl = lastScene?.backgroundUrl;

  return (
    <div
      className="relative rounded-2xl min-h-[400px] sm:min-h-[460px] lg:min-h-[540px] w-full overflow-hidden"
      data-llm={`Game "${gameData.title}" is ending. Player earned ${gameState.unlockedAchievements.length}/${gameData.allAchievements.length} achievements and visited ${gameState.visitedScenes.length}/${gameData.scenes.length} scenes.`}
    >
      {bgUrl && <div className="vn-background" style={{ backgroundImage: `url(${bgUrl})` }} />}
      <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-10 scene-fade-in">
        <div className="text-center px-6 max-w-lg">
          <h1 className="title-glow text-4xl md:text-5xl font-bold text-[#c4a747] mb-3">The End</h1>
          <p className="text-[#f0e6d0] text-lg mb-8 opacity-80">{gameData.title}</p>

          {/* Stats */}
          <div className="flex justify-center gap-8 mb-8 text-sm">
            <div className="text-center">
              <div className="text-2xl text-[#c4a747] font-bold">{gameState.visitedScenes.length}</div>
              <div className="text-[#8a8a9a] uppercase tracking-wider text-xs">Scenes</div>
            </div>
            <div className="text-center">
              <div className="text-2xl text-[#c4a747] font-bold">{gameState.totalChoices}</div>
              <div className="text-[#8a8a9a] uppercase tracking-wider text-xs">Choices</div>
            </div>
            <div className="text-center">
              <div className="text-2xl text-[#c4a747] font-bold">{gameState.unlockedAchievements.length}</div>
              <div className="text-[#8a8a9a] uppercase tracking-wider text-xs">Achievements</div>
            </div>
          </div>

          {/* Achievements */}
          {gameState.unlockedAchievements.length > 0 && (
            <div className="bg-black/50 rounded-lg border border-[#c4a747]/30 p-5 mb-6">
              <h2 className="text-[#c4a747] text-xs font-bold uppercase tracking-wider mb-4 text-center">
                Achievements Earned
              </h2>
              <div className="space-y-3">
                {gameState.unlockedAchievements.map((aId, i) => {
                  const a = gameData.allAchievements.find((ach) => ach.id === aId);
                  if (!a) return null;
                  return (
                    <div
                      key={aId}
                      className="card-stagger-in flex items-center gap-3 text-[#f0e6d0]"
                      style={{ animationDelay: `${i * 0.1}s` }}
                    >
                      <span className="text-xl">{a.icon}</span>
                      <div className="text-left">
                        <div className="text-sm font-semibold">
                          {a.name}
                          <span className="ml-2 text-[10px] text-[#8a8a9a]">
                            {ACHIEVEMENT_TYPE_ICONS[a.type] || ""} {a.type}
                          </span>
                        </div>
                        <div className="text-xs text-[#8a8a9a]">{a.description}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {gameState.unlockedAchievements.length < gameData.allAchievements.length && (
            <p className="text-[#8a8a9a] text-xs italic">
              {gameData.allAchievements.length - gameState.unlockedAchievements.length} achievement
              {gameData.allAchievements.length - gameState.unlockedAchievements.length > 1 ? "s" : ""}{" "}
              remain hidden...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// MAIN WIDGET (STATE MACHINE)
// ═══════════════════════════════════════

function QuestForgeGame() {
  const toolInfo = useToolInfo<"quest-forge-game">();
  const [, setDisplayMode] = useDisplayMode();
  const [gameState, setGameState] = useWidgetState<GameState>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const gameData: GameData | null = toolInfo.isSuccess
    ? (toolInfo.responseMetadata as { gameData: GameData }).gameData
    : null;

  // Initialize on first load
  useEffect(() => {
    if (gameData && !gameState) {
      setGameState({
        screen: "title",
        currentSceneId: gameData.startSceneId,
        unlockedAchievements: [],
        visitedScenes: [gameData.startSceneId],
        totalChoices: 0,
        introIndex: 0,
        showTransition: false,
        transitionText: "",
      });
    }
  }, [gameData, gameState, setGameState]);

  const transitionTo = useCallback(
    (newScreen: Screen) => {
      if (!gameState) return;
      setIsTransitioning(true);
      setTimeout(() => {
        setGameState({ ...gameState, screen: newScreen });
        setIsTransitioning(false);
      }, 400);
    },
    [gameState, setGameState],
  );

  // Loading
  if (!gameData || !gameState) {
    return (
      <div className="flex items-center justify-center rounded-2xl min-h-[400px] sm:min-h-[450px] lg:min-h-[520px] bg-[#0a0a0f]">
        <div className="text-center">
          <div className="loading-pulse text-[#c4a747] text-lg font-semibold mb-2">
            Building gameplay mechanics...
          </div>
          <div className="text-[#8a8a9a] text-sm">Preparing achievements and scene transitions</div>
        </div>
      </div>
    );
  }

  const transitionClass = isTransitioning ? "opacity-0 scale-[0.98]" : "opacity-100 scale-100";

  if (gameState.screen === "title") {
    return (
      <ScreenTransition screenKey="title">
        <div className={`transition-all duration-400 ${transitionClass}`}>
          <TitleScreen
            gameData={gameData}
            onStart={() => {
              setDisplayMode("fullscreen");
              transitionTo("intro");
            }}
          />
        </div>
      </ScreenTransition>
    );
  }

  if (gameState.screen === "intro") {
    return (
      <ScreenTransition screenKey="intro">
        <div className={`transition-all duration-400 ${transitionClass}`}>
          <IntroScreen gameData={gameData} onContinue={() => transitionTo("game")} />
        </div>
      </ScreenTransition>
    );
  }

  if (gameState.screen === "end") {
    return (
      <ScreenTransition screenKey="end">
        <EndScreen gameData={gameData} gameState={gameState} />
      </ScreenTransition>
    );
  }

  // Game
  return (
    <ScreenTransition screenKey="game">
      <div className={`transition-all duration-400 ${transitionClass}`}>
        <GameScreen
          gameData={gameData}
          gameState={gameState}
          setGameState={(s) => setGameState(s)}
          onEnd={() => transitionTo("end")}
        />
      </div>
    </ScreenTransition>
  );
}

mountWidget(<QuestForgeGame />);
