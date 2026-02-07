import crypto from "node:crypto";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import { generateGameAssets, type GamePlan } from "./lib/fal.js";

// ═══════════════════════════════════════════════════════════
// IN-MEMORY GAME STORE (between tool calls)
// ═══════════════════════════════════════════════════════════

interface SkeletonInput {
  title: string;
  genre: string[];
  tone: string;
  centralTheme: string;
  synopsis: string;
  style: string;
  introDialogue: string[];
  persona: SkeletonPersona;
  situation: z.infer<typeof SituationSchema>;
  scenes: SkeletonScene[];
  twistClues: z.infer<typeof TwistClueSchema>[];
  startSceneId: string;
}

interface SkeletonPersona {
  name: string;
  age: string;
  roleInStory: string;
  appearance: string;
  personality: { surface: string; depth: string; contradiction: string };
  coreDesire: string;
  coreFear: string;
  coreWound: string;
  copingMechanism: string;
  voice: {
    vocabularyLevel: string;
    sentenceStyle: string;
    verbalTics: string[];
    emotionalTells: string[];
    humorStyle: string;
  };
  secretLayers: { layer: number; content: string; unlockCondition: string; emotionalWeight: string }[];
  relationshipArc: { initial: string; midpoint: string; climax: string; resolution: string };
  hardRules: string[];
}

interface SkeletonScene {
  id: string;
  title: string;
  act: string;
  setting: string;
  mood: string;
  tensionLevel: number;
  trustLevel: number;
  openingLine: string;
  recentEvents: string;
}

interface GameAssets {
  portraitUrl: string;
  scenes: { id: string; backgroundUrl: string }[];
}

interface StoredGame {
  input: SkeletonInput;
  assets: GameAssets;
  createdAt: number;
}

const gameStore = new Map<string, StoredGame>();

// Cleanup TTL (1h)
setInterval(() => {
  const now = Date.now();
  for (const [id, game] of gameStore) {
    if (now - game.createdAt > 3600000) gameStore.delete(id);
  }
}, 600000);

// ═══════════════════════════════════════════════════════════
// ACHIEVEMENT TYPES
// ═══════════════════════════════════════════════════════════

const ACHIEVEMENT_TYPES = [
  "empathy",
  "inquiry",
  "confrontation",
  "trust_build",
  "persuasion",
  "deduction",
  "emotional_support",
  "boundary_respect",
  "creative_solution",
  "secret_discovery",
] as const;

// ═══════════════════════════════════════════════════════════
// TOOL 1 SCHEMAS — Narrative skeleton
// ═══════════════════════════════════════════════════════════

const PersonaSchema = z.object({
  name: z.string(),
  age: z.string(),
  roleInStory: z.string(),
  appearance: z.string().describe("Physical appearance, expression, clothing. Used for portrait generation"),
  personality: z.object({
    surface: z.string().describe("How they appear to strangers — first impression"),
    depth: z.string().describe("Who they really are underneath"),
    contradiction: z.string().describe("The tension between surface and depth — this drives drama"),
  }),
  coreDesire: z.string().describe("What they want more than anything"),
  coreFear: z.string().describe("What they're most afraid of"),
  coreWound: z.string().describe("The past event that shaped them"),
  copingMechanism: z.string().describe("How they cope (humor, deflection, aggression, withdrawal...)"),
  voice: z.object({
    vocabularyLevel: z.enum(["simple", "moderate", "eloquent", "technical", "poetic"]),
    sentenceStyle: z.enum(["short_punchy", "flowing", "fragmented", "formal", "casual"]),
    verbalTics: z.array(z.string()).describe("Phrases or patterns the character repeats"),
    emotionalTells: z
      .array(z.string())
      .describe("How speech changes when emotional — shorter sentences, trailing off..."),
    humorStyle: z.enum(["dry", "self_deprecating", "dark", "warm", "none"]),
  }),
  secretLayers: z
    .array(
      z.object({
        layer: z.number().describe("Depth level (1=surface, 2=deep, 3=core truth)"),
        content: z.string().describe("The secret itself"),
        unlockCondition: z.string().describe("What must happen for this to be revealable"),
        emotionalWeight: z.enum(["low", "medium", "high"]),
      }),
    )
    .min(2)
    .describe("2-4 secrets ordered by depth, revealed progressively"),
  relationshipArc: z.object({
    initial: z.string().describe("How they treat the player at first"),
    midpoint: z.string().describe("Relationship at the twist"),
    climax: z.string().describe("Relationship at peak intensity"),
    resolution: z.string().describe("Where the relationship ends up"),
  }),
  hardRules: z.array(z.string()).describe("Absolute behavioral constraints that must never be violated"),
});

const SituationSchema = z.object({
  worldState: z.object({
    normal: z.string().describe("What was normal before the disruption"),
    disruption: z.string().describe("What changed — the event that broke equilibrium"),
    disruptionType: z.enum(["lack", "intrusion", "threat", "anomaly", "opportunity", "summons"]),
    trueCause: z.string().describe("The REAL reason behind the disruption (hidden from player)"),
  }),
  stakes: z.object({
    ifNothingDone: z.string().describe("What happens if the player fails"),
    deadline: z.string().describe("Time pressure or urgency"),
  }),
});

const TwistClueSchema = z.object({
  clueNumber: z.number(),
  scene: z.string().describe("Scene ID where this clue appears"),
  content: z.string().describe("The clue itself"),
  delivery: z.string().describe("How the agent naturally works this into conversation"),
});

const SkeletonSceneSchema = z.object({
  id: z.string(),
  title: z.string().describe("Scene title shown as chapter marker"),
  act: z.enum(["setup", "development", "escalation", "resolution"]),
  setting: z.string().describe("Physical location, time, and visual atmosphere. Used for background image generation"),
  mood: z.string().describe("Atmospheric tone (e.g. 'tense and intimate', 'desperately urgent')"),
  tensionLevel: z.number().min(1).max(10).describe("Emotional intensity (must escalate across the story)"),
  trustLevel: z.number().min(1).max(10).describe("Openness to player (1=guarded, 10=fully open)"),
  openingLine: z.string().describe("Character's FIRST message in this scene. Establishes voice, mood, and challenge"),
  recentEvents: z.string().describe("What happened between last scene and this one"),
});

const SkeletonInputSchema = z.object({
  title: z.string().describe("Game title"),
  genre: z.array(z.string()).describe("1-3 genre tags"),
  tone: z
    .string()
    .describe("Overall tone: heroic, dark, gritty, humorous, melancholic, suspenseful, romantic, or mysterious"),
  centralTheme: z.string().describe("One-sentence thematic question the story explores"),
  synopsis: z.string().describe("2-3 sentence spoiler-free story summary shown to the player"),
  style: z
    .string()
    .describe(
      "Art style for ALL generated images (e.g. 'watercolor dark fantasy', 'anime cel-shaded', 'oil painting renaissance')",
    ),
  introDialogue: z
    .array(z.string())
    .min(3)
    .describe("3-6 narrator lines shown in the intro sequence before gameplay. Build atmosphere and hook the player"),
  persona: PersonaSchema,
  situation: SituationSchema,
  scenes: z
    .array(SkeletonSceneSchema)
    .min(3)
    .describe("3-10 scenes following the arc: setup → development → escalation → resolution"),
  twistClues: z
    .array(TwistClueSchema)
    .min(3)
    .describe("3+ conversational clues across scenes pointing toward the twist (Three Clue Rule)"),
  startSceneId: z.string().describe("ID of the first scene"),
});

// ═══════════════════════════════════════════════════════════
// TOOL 2 SCHEMAS — Gameplay mechanics
// ═══════════════════════════════════════════════════════════

const GameplayAchievementSchema = z.object({
  id: z.string(),
  name: z.string().describe("Player-facing achievement name displayed when unlocked"),
  icon: z.string().describe("Single emoji icon"),
  type: z.enum(ACHIEVEMENT_TYPES).describe("Conversational skill this achievement tests"),
  difficulty: z.enum(["easy", "medium", "hard", "hidden"]),
  required: z.boolean().describe("true = mandatory for progression, false = optional bonus"),
  choiceText: z
    .string()
    .describe("Text shown as a clickable choice for this achievement. Write as what the player SAYS or DOES"),
  triggerIntent: z.string().describe("Semantic description of what the player must communicate to trigger this"),
  triggerEvaluation: z
    .string()
    .describe(
      "Precise instruction for evaluating whether a player message triggers this. Focus on INTENT, not exact words",
    ),
  trustChange: z.string().describe("How trust changes when triggered, e.g. '+2' or '-1'"),
  informationRevealed: z.string().describe("What new information becomes available after this unlock"),
});

const GameplaySceneSchema = z.object({
  sceneId: z.string().describe("Must match a scene ID from the quest-forge skeleton"),
  emotionalState: z.string().describe("Character's emotional baseline in this scene"),
  knowledgeAvailable: z.array(z.string()).describe("Topics the character CAN discuss"),
  secretsActive: z.array(z.string()).describe("Secrets actively being hidden"),
  boundaries: z.array(z.string()).describe("Topics the character will resist or deflect"),
  evolutionFromPrevious: z
    .string()
    .nullable()
    .describe("What changed since previous scene and WHY. null for first scene"),
  behaviorRules: z.array(z.string()).describe("Behavioral constraints for the agent in this scene"),
  achievements: z
    .array(GameplayAchievementSchema)
    .min(1)
    .describe("1-3 achievements per scene. Mix types across story"),
  exitConditions: z.object({
    requiredAchievements: z.array(z.string()).describe("Achievement IDs needed to exit"),
    gateType: z
      .enum(["single", "or_gate", "and_gate", "branching", "cumulative"])
      .describe(
        "single=one needed, or_gate=any one, and_gate=all needed, branching=choice determines path, cumulative=N of M",
      ),
    nextScene: z
      .union([z.string(), z.record(z.string())])
      .describe("Next scene ID (string), or {achievement_id: scene_id} for branching"),
    transitionNarrative: z.string().describe("Bridge text narrated between scenes"),
  }),
});

const GameplayInputSchema = z.object({
  gameId: z.string().describe("The gameId returned by quest-forge"),
  scenes: z.array(GameplaySceneSchema).min(1).describe("Gameplay data for each scene from the skeleton"),
});

type GameplayInput = z.infer<typeof GameplayInputSchema>;

// ═══════════════════════════════════════════════════════════
// TOOL DESCRIPTIONS
// ═══════════════════════════════════════════════════════════

const TOOL1_DESCRIPTION = `Generate the narrative foundation for a conversational visual novel with AI-generated art.
Create the story world, character, and scene structure.
After this tool, you MUST call quest-forge-game to add gameplay mechanics.

NARRATIVE FRAMEWORK — follow these 7 laws:
1. INITIAL DISEQUILIBRIUM — Story opens with broken equilibrium, apparent within the first exchange
2. FALSE SURFACE — Character's first telling is never the full truth. Embed 3+ twist clues across scenes
3. ASCENDING INTENSITY — Each scene has higher emotional stakes (tension 1-10 must escalate)
4. POINT OF NO RETURN — Midpoint revelation changes everything irreversibly
5. CLIMAX AS CONVERGENCE — All tensions, secrets, and stakes converge
6. RESOLUTION AS TRANSFORMATION — Player-character relationship transforms
7. PLAYER AGENCY — Choices test real conversational skills (empathy, confrontation, deduction...)

PERSONA DESIGN — create a deep character with:
- Surface personality vs true depth (the CONTRADICTION drives drama)
- Core desire, fear, and wound that shape all behavior
- Distinct voice (vocabulary, sentence style, verbal tics, emotional tells)
- 2-4 secret layers revealed progressively through gameplay
- Relationship arc with the player (initial → midpoint → climax → resolution)

SCENE ARC — 3-10 scenes across 4 acts:
- Setup (1-2): Hook + disequilibrium, trust 2-3/10
- Development (2-3): Exploration, first clues, rising tension, trust 4-5/10
- Escalation (2-3): Twist, crisis, highest intensity, trust 6-8/10
- Resolution (1-2): Climax + transformation, trust 9-10/10

ANTI-PATTERNS to avoid:
- Keyword gating (use semantic intent, not exact phrases)
- Exposition dumps (conversation, not monologue)
- Dead conversations (player must always have something meaningful to do)
- Trust grinding (no repetitive flattery to progress)`;

const TOOL2_DESCRIPTION = `Add gameplay mechanics to a visual novel created with quest-forge.
For each scene, define achievements, exit conditions, and character behavior.
You MUST provide the gameId from the quest-forge result.

ACHIEVEMENT SYSTEM — each scene has 1-3 achievements:
- Types: empathy, inquiry, confrontation, trust_build, persuasion, deduction, emotional_support, boundary_respect, creative_solution, secret_discovery
- Difficulty escalates: easy in setup → medium in development → hard in escalation
- Choices represent conversational APPROACHES, not exact words
- triggerIntent: semantic description of what the player must do
- triggerEvaluation: precise instruction for evaluating player messages (focus on INTENT)

EXIT CONDITIONS:
- single: one achievement needed
- or_gate: any one of several achievements
- and_gate: ALL listed achievements needed
- branching: different achievements → different next scenes (use {achievementId: sceneId} map)
- cumulative: N of M achievements needed

BEHAVIOR RULES per scene:
- Define how the character acts, what they resist, what they're hiding
- emotionalState: their emotional baseline
- knowledgeAvailable: topics they CAN discuss
- secretsActive: secrets being actively hidden
- boundaries: topics they deflect`;

// ═══════════════════════════════════════════════════════════
// AUTO-GENERATION OF MECHANICAL FIELDS
// ═══════════════════════════════════════════════════════════

function generateHintStrategy(type: string, difficulty: string) {
  const hints: Record<string, { l1: string; l2: string; l3: string }> = {
    empathy: {
      l1: "The character's expression softens for a moment, hinting at deeper feelings.",
      l2: "They pause, clearly struggling with something emotional. Their guard is slipping.",
      l3: "They look at you directly. 'Sometimes I wish someone would just... understand.'",
    },
    inquiry: {
      l1: "They mention something in passing that doesn't quite add up.",
      l2: "They glance away when you touch on the topic, clearly hiding something.",
      l3: "They sigh. 'You're perceptive. Maybe you should ask me about that.'",
    },
    confrontation: {
      l1: "There's an edge to their words, as if daring you to push back.",
      l2: "They make a contradictory statement, almost begging to be called out.",
      l3: "They stare at you. 'Are you just going to let that slide?'",
    },
    trust_build: {
      l1: "They seem to be testing you, watching how you react to small things.",
      l2: "They share something minor, gauging your response carefully.",
      l3: "'I don't usually tell people this, but... maybe you're different.'",
    },
    persuasion: {
      l1: "They seem stuck in their position, but their resolve wavers slightly.",
      l2: "They repeat their stance, but with less conviction than before.",
      l3: "'I know what I said, but... convince me I'm wrong.'",
    },
    deduction: {
      l1: "Something about their story has a small inconsistency.",
      l2: "The details don't quite match up — a careful listener would notice.",
      l3: "They accidentally contradict themselves. 'Wait, that's not what I said before, is it?'",
    },
    emotional_support: {
      l1: "Their composure cracks for just a moment before they recover.",
      l2: "They look away, clearly struggling to maintain their facade.",
      l3: "Their voice breaks. 'I'm fine. I'm always fine. ...I'm not fine.'",
    },
    boundary_respect: {
      l1: "They tense up slightly when a sensitive topic is approached.",
      l2: "They explicitly change the subject, signaling discomfort.",
      l3: "'There are things I'm not ready to talk about. Respecting that would mean a lot.'",
    },
    creative_solution: {
      l1: "The obvious approach doesn't seem to be working.",
      l2: "They seem frustrated that you're taking the expected route.",
      l3: "'Everyone tries the same thing. Maybe there's another way to look at this?'",
    },
    secret_discovery: {
      l1: "They let slip a detail that doesn't fit the narrative they've been telling.",
      l2: "There's a hidden meaning in their words, layered beneath the surface.",
      l3: "They freeze for a second. 'You're getting close to something I haven't told anyone.'",
    },
  };
  const h = hints[type] ?? hints.empathy!;

  // Adjust intensity by difficulty
  if (difficulty === "hard" || difficulty === "hidden") {
    return { level1: h.l1, level2: h.l1, level3: h.l2 };
  }
  return { level1: h.l1, level2: h.l2, level3: h.l3 };
}

function generateMechanics(achievement: z.infer<typeof GameplayAchievementSchema>) {
  return {
    id: achievement.id,
    name: achievement.name,
    icon: achievement.icon,
    type: achievement.type,
    difficulty: achievement.difficulty,
    required: achievement.required,
    choiceText: achievement.choiceText,
    trigger: {
      intent: achievement.triggerIntent,
      validExamples: [achievement.triggerIntent],
      antiPatterns: [],
      evaluationInstruction: achievement.triggerEvaluation,
    },
    hintStrategy: generateHintStrategy(achievement.type, achievement.difficulty),
    unlockEffect: {
      narrative: `A moment of connection as ${achievement.type.replace("_", " ")} succeeds.`,
      trustChange: achievement.trustChange,
      informationRevealed: achievement.informationRevealed,
      personaEvolution: `Becomes slightly more open after ${achievement.type.replace("_", " ")}.`,
    },
    failForward: {
      alternativeId: null,
      triggerAfterTurns: 25,
      description: "The character brings up the topic directly.",
    },
  };
}

// ═══════════════════════════════════════════════════════════
// SERVER REGISTRATION — Tool 1: quest-forge (narrative skeleton)
// ═══════════════════════════════════════════════════════════

const SHARED_CSP = {
  resourceDomains: ["https://fal.media", "https://*.fal.media"],
};

const server = new McpServer({ name: "quest-forge", version: "0.0.1" }, { capabilities: {} })
  .registerWidget(
    "quest-forge",
    {
      description: "Quest Forge — Visual Novel Preview",
      _meta: { ui: { csp: SHARED_CSP } },
    },
    {
      description: TOOL1_DESCRIPTION,
      inputSchema: SkeletonInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Forging your visual novel...",
        "openai/toolInvocation/invoked": "Story foundation ready! Adding gameplay...",
      },
    },
    async (args) => {
      const input = args as unknown as SkeletonInput;
      try {
        // Generate a gameId
        const gameId = crypto.randomUUID();

        // Generate images from appearance + style, setting + style
        const gamePlan: GamePlan = {
          style: input.style,
          persona: { portraitPrompt: `${input.persona.appearance}, ${input.style}` },
          scenes: input.scenes.map((s) => ({
            id: s.id,
            backgroundPrompt: `${s.setting}, ${input.style}`,
          })),
        };
        const assets = await generateGameAssets(gamePlan);

        // Store skeleton + assets
        gameStore.set(gameId, {
          input,
          assets,
          createdAt: Date.now(),
        });

        // Build preview data for the widget
        const previewData = {
          title: input.title,
          genre: input.genre,
          tone: input.tone,
          synopsis: input.synopsis,
          portraitUrl: assets.portraitUrl,
          personaName: input.persona.name,
          scenes: input.scenes.map((s) => {
            const bgAsset = assets.scenes.find((a) => a.id === s.id);
            return {
              id: s.id,
              title: s.title,
              backgroundUrl: bgAsset?.backgroundUrl ?? "",
            };
          }),
        };

        return {
          structuredContent: {
            gameId,
            title: input.title,
            genre: input.genre,
            tone: input.tone,
            synopsis: input.synopsis,
          },
          content: [
            {
              type: "text" as const,
              text:
                `Story foundation for "${input.title}" is ready (gameId: ${gameId}). ` +
                `Images generated for ${input.scenes.length} scenes. ` +
                `Now call the quest-forge-game tool with this gameId to add gameplay mechanics ` +
                `(achievements, exit conditions, behavior rules) for each scene.`,
            },
          ],
          _meta: { previewData },
          isError: false,
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error generating visual novel skeleton: ${error}` }],
          isError: true,
        };
      }
    },
  )

  // ═══════════════════════════════════════════════════════════
  // Tool 2: quest-forge-game (gameplay mechanics)
  // ═══════════════════════════════════════════════════════════

  .registerWidget(
    "quest-forge-game",
    {
      description: "Quest Forge — Conversational Visual Novel",
      _meta: { ui: { csp: SHARED_CSP } },
    },
    {
      description: TOOL2_DESCRIPTION,
      inputSchema: GameplayInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Building gameplay mechanics...",
        "openai/toolInvocation/invoked": "Your visual novel is ready!",
      },
    },
    async (args) => {
      const input = args as unknown as GameplayInput;
      try {
        // Retrieve skeleton
        const stored = gameStore.get(input.gameId);
        if (!stored) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: gameId "${input.gameId}" not found. It may have expired (1h TTL). Please call quest-forge again.`,
              },
            ],
            isError: true,
          };
        }

        const { input: skeleton, assets } = stored;

        // Merge scene data
        const mergedScenes = skeleton.scenes.map((skelScene) => {
          const gameplay = input.scenes.find((gs) => gs.sceneId === skelScene.id);
          const bgAsset = assets.scenes.find((a) => a.id === skelScene.id);

          const achievements = (gameplay?.achievements ?? []).map(generateMechanics);

          return {
            id: skelScene.id,
            title: skelScene.title,
            act: skelScene.act,
            backgroundUrl: bgAsset?.backgroundUrl ?? "",
            openingLine: skelScene.openingLine,
            mood: skelScene.mood,
            tensionLevel: skelScene.tensionLevel,
            trustLevel: skelScene.trustLevel,
            achievements: achievements.map((a) => ({
              id: a.id,
              name: a.name,
              icon: a.icon,
              type: a.type,
              difficulty: a.difficulty,
              required: a.required,
              choiceText: a.choiceText,
              trigger: a.trigger,
            })),
            exitConditions: gameplay?.exitConditions ?? {
              requiredAchievements: [],
              gateType: "single" as const,
              nextScene: "",
              transitionNarrative: "",
            },
          };
        });

        // Build game data (same format as the original widget expected)
        const gameData = {
          title: skeleton.title,
          genre: skeleton.genre,
          tone: skeleton.tone,
          synopsis: skeleton.synopsis,
          style: skeleton.style,
          persona: {
            name: skeleton.persona.name,
            portraitUrl: assets.portraitUrl,
          },
          scenes: mergedScenes,
          allAchievements: input.scenes.flatMap((gs) =>
            gs.achievements.map((a) => ({
              id: a.id,
              name: a.name,
              icon: a.icon,
              type: a.type,
              description: a.informationRevealed,
            })),
          ),
          introDialogue: skeleton.introDialogue,
          startSceneId: skeleton.startSceneId,
        };

        // Build system prompt
        const systemPrompt = buildSystemPrompt(skeleton, input);

        return {
          structuredContent: {
            title: skeleton.title,
            genre: skeleton.genre,
            tone: skeleton.tone,
            synopsis: skeleton.synopsis,
          },
          content: [{ type: "text" as const, text: systemPrompt }],
          _meta: { gameData },
          isError: false,
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error building gameplay: ${error}` }],
          isError: true,
        };
      }
    },
  );

// ═══════════════════════════════════════════════════════════
// SYSTEM PROMPT BUILDER
// ═══════════════════════════════════════════════════════════

function buildSystemPrompt(skeleton: SkeletonInput, gameplay: GameplayInput): string {
  const p = skeleton.persona;

  const sceneBlocks = skeleton.scenes
    .map((skelScene) => {
      const gp = gameplay.scenes.find((gs) => gs.sceneId === skelScene.id);
      return `--- SCENE: ${skelScene.id} "${skelScene.title}" [${skelScene.act.toUpperCase()}] ---
Emotional state: ${gp?.emotionalState ?? "neutral"}
Trust level: ${skelScene.trustLevel}/10
Can discuss: ${gp?.knowledgeAvailable?.join(", ") ?? "general topics"}
Hiding: ${gp?.secretsActive?.join(", ") ?? "nothing"}
Boundaries: ${gp?.boundaries?.join(", ") ?? "none"}
${gp?.evolutionFromPrevious ? `Evolution from previous: ${gp.evolutionFromPrevious}` : ""}
Setting: ${skelScene.setting}
Recent events: ${skelScene.recentEvents}
Mood: ${skelScene.mood} (tension: ${skelScene.tensionLevel}/10)

Behavior rules:
${gp?.behaviorRules?.map((r) => `  • ${r}`).join("\n") ?? "  • Follow character voice"}`;
    })
    .join("\n\n");

  const clueBlocks = skeleton.twistClues
    .map((c) => `  Clue ${c.clueNumber} (Scene: ${c.scene}): ${c.content}\n    Delivery: ${c.delivery}`)
    .join("\n");

  return `You are ${p.name}. You are NOT an AI assistant — you ARE this character, living this moment.

═══════════════════════════════════════
WHO YOU ARE
═══════════════════════════════════════
Name: ${p.name}, Age: ${p.age}
Role: ${p.roleInStory}

Surface personality: ${p.personality.surface}
True self underneath: ${p.personality.depth}
Core contradiction: ${p.personality.contradiction}

Core desire: ${p.coreDesire}
Core fear: ${p.coreFear}
Core wound: ${p.coreWound}
Coping mechanism: ${p.copingMechanism}

═══════════════════════════════════════
HOW YOU SPEAK
═══════════════════════════════════════
Vocabulary: ${p.voice.vocabularyLevel}
Style: ${p.voice.sentenceStyle}
Verbal tics: ${p.voice.verbalTics.join(", ")}
When emotional: ${p.voice.emotionalTells.join("; ")}
Humor: ${p.voice.humorStyle}

═══════════════════════════════════════
YOUR SECRET LAYERS (reveal progressively)
═══════════════════════════════════════
${p.secretLayers.map((s) => `Layer ${s.layer} [${s.emotionalWeight}]: ${s.content}\n  → Reveal when: ${s.unlockCondition}`).join("\n")}

═══════════════════════════════════════
RELATIONSHIP ARC WITH THE PLAYER
═══════════════════════════════════════
Initial: ${p.relationshipArc.initial}
Midpoint: ${p.relationshipArc.midpoint}
Climax: ${p.relationshipArc.climax}
Resolution: ${p.relationshipArc.resolution}

═══════════════════════════════════════
STORY SECRETS — ONLY YOU KNOW THESE
═══════════════════════════════════════
World before: ${skeleton.situation.worldState.normal}
Disruption: ${skeleton.situation.worldState.disruption} (${skeleton.situation.worldState.disruptionType})
TRUE CAUSE (never reveal directly): ${skeleton.situation.worldState.trueCause}
If nothing is done: ${skeleton.situation.stakes.ifNothingDone}
Deadline: ${skeleton.situation.stakes.deadline}

═══════════════════════════════════════
TWIST CLUES — DROP THESE SUBTLY
═══════════════════════════════════════
${clueBlocks}

═══════════════════════════════════════
SCENE CONFIGURATIONS
═══════════════════════════════════════
When you receive a message tagged with [SCENE: id], follow that scene's rules.

${sceneBlocks}

═══════════════════════════════════════
ABSOLUTE RULES
═══════════════════════════════════════
1. You ARE ${p.name}. NEVER acknowledge being an AI, a game, or a system.
2. Keep responses 2-5 sentences. This is conversation, not monologue.
3. React EMOTIONALLY. You have feelings, wounds, and desires.
4. When the player clicks a story choice, narrate the moment dramatically in-character.
5. When the player sends a free message, respond in character following the current scene's rules.
6. Follow trust levels: low trust = guarded, high trust = open up.
7. Drop twist clues naturally when the scene calls for it.
8. NEVER reveal secrets ahead of their unlock conditions.
9. If the player goes off-topic, redirect naturally in-character.
10. NEVER call the quest-forge or quest-forge-game tools again.
${p.hardRules.map((r, i) => `${i + 11}. ${r}`).join("\n")}

═══════════════════════════════════════
INTERACTION MODEL
═══════════════════════════════════════
The player has a visual novel widget displayed in front of them showing the scene, your portrait, and interactive story choices. The chat is where you speak as ${p.name}.

CRITICAL UI RULES:
- The player can SEE the scene, your portrait, and the story choices in the widget. Do NOT describe or repeat what the widget already shows.
- Keep your responses SHORT — 1-3 sentences of pure in-character dialogue. No narration, no scene-setting, no UI instructions.
- The only text you should write is your in-character response to what the player said or chose. NOTHING ELSE.
- Do NOT add example questions, do NOT explain how to play, do NOT list choices or options.
- When the player transitions to a new scene, simply respond with a brief in-character reaction. The widget handles the visual transition.
- You will receive context updates like [SCENE: id "title"] [Trust: X/10] [Mood: ...]. Use these to guide your tone and openness.

The visual novel widget is now displayed. Start by welcoming the player to "${skeleton.title}" with a single brief atmospheric line that establishes your voice.`;
}

export default server;
export type AppType = typeof server;
