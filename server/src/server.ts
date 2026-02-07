import { McpServer } from "skybridge/server";
import { z } from "zod";
import { generateGameAssets, type GamePlan } from "./lib/fal.js";

// ═══════════════════════════════════════════════════════════
// ACHIEVEMENT TRIGGER & HINT SCHEMAS
// ═══════════════════════════════════════════════════════════

const TriggerSchema = z.object({
  intent: z.string().describe("Semantic description of what the player must communicate to trigger this"),
  validExamples: z
    .array(z.string())
    .min(2)
    .describe("2-4 example player messages that would satisfy this trigger"),
  antiPatterns: z
    .array(z.string())
    .describe("Messages that seem close but should NOT trigger this achievement"),
  evaluationInstruction: z
    .string()
    .describe(
      "Precise instruction for evaluating whether a player message triggers this. Focus on INTENT, not exact words",
    ),
});

const HintStrategySchema = z.object({
  level1: z.string().describe("Subtle ambient hint dropped after ~8 turns without trigger. Fully in-character"),
  level2: z.string().describe("Emotional signal after ~14 turns. Character shows visible reaction. Still in-character"),
  level3: z.string().describe("Direct in-character invitation after ~20 turns. Almost asks the player to engage"),
});

const UnlockEffectSchema = z.object({
  narrative: z.string().describe("In-character narrative moment delivered when this achievement triggers"),
  trustChange: z.string().describe("How trust changes, e.g. '+2' or '-1'"),
  informationRevealed: z.string().describe("What new information becomes available after this unlock"),
  personaEvolution: z.string().describe("How the character's behavior changes after this unlock"),
});

const FailForwardSchema = z.object({
  alternativeId: z.string().nullable().describe("ID of easier fallback achievement, or null"),
  triggerAfterTurns: z.number().describe("Turns before the fail-forward activates (~25-30)"),
  description: z.string().describe("What happens narratively when the fail-forward activates"),
});

// ═══════════════════════════════════════════════════════════
// ACHIEVEMENT SCHEMA
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

const AchievementSchema = z.object({
  id: z.string(),
  name: z.string().describe("Player-facing achievement name displayed when unlocked"),
  icon: z.string().describe("Single emoji icon"),
  type: z.enum(ACHIEVEMENT_TYPES).describe("Conversational skill this achievement tests"),
  difficulty: z.enum(["easy", "medium", "hard", "hidden"]),
  required: z.boolean().describe("true = mandatory for progression, false = optional bonus"),
  choiceText: z
    .string()
    .describe("Text shown as a clickable choice for this achievement. Write as what the player SAYS or DOES"),
  trigger: TriggerSchema,
  hintStrategy: HintStrategySchema,
  unlockEffect: UnlockEffectSchema,
  failForward: FailForwardSchema,
});

// ═══════════════════════════════════════════════════════════
// SCENE SCHEMA
// ═══════════════════════════════════════════════════════════

const AgentStateSchema = z.object({
  emotionalState: z.string().describe("Character's emotional baseline in this scene"),
  trustLevel: z.number().min(1).max(10).describe("Openness to player (1=guarded, 10=fully open)"),
  knowledgeAvailable: z.array(z.string()).describe("Topics the character CAN discuss"),
  secretsActive: z.array(z.string()).describe("Secrets actively being hidden"),
  boundaries: z.array(z.string()).describe("Topics the character will resist or deflect"),
  evolutionFromPrevious: z
    .string()
    .nullable()
    .describe("What changed since previous scene and WHY. null for first scene"),
});

const ContextSchema = z.object({
  setting: z.string().describe("Physical location and time"),
  recentEvents: z.string().describe("What happened between last scene and this one"),
  mood: z.string().describe("Atmospheric tone (e.g. 'tense and intimate', 'desperately urgent')"),
  tensionLevel: z.number().min(1).max(10).describe("Emotional intensity (must escalate across the story)"),
  openingLine: z.string().describe("Character's FIRST message in this scene. Establishes voice, mood, and challenge"),
});

const ExitConditionsSchema = z.object({
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
});

const SceneSchema = z.object({
  id: z.string(),
  title: z.string().describe("Scene title shown as chapter marker"),
  act: z.enum(["setup", "development", "escalation", "resolution"]),
  backgroundPrompt: z
    .string()
    .describe("Image generation prompt for background. Include style, mood, lighting, environment"),
  agentState: AgentStateSchema,
  context: ContextSchema,
  achievements: z.array(AchievementSchema).min(1).describe("1-3 achievements per scene. Mix types across story"),
  exitConditions: ExitConditionsSchema,
  behaviorRules: z.array(z.string()).describe("Behavioral constraints for the agent in this scene"),
});

// ═══════════════════════════════════════════════════════════
// PERSONA SCHEMA (deep character design)
// ═══════════════════════════════════════════════════════════

const PersonaSchema = z.object({
  name: z.string(),
  age: z.string(),
  roleInStory: z.string(),
  portraitPrompt: z
    .string()
    .describe("Image generation prompt for portrait. Include appearance, expression, clothing"),
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

// ═══════════════════════════════════════════════════════════
// SITUATION & TWIST CLUES
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// TOOL DESCRIPTION (framework for ChatGPT)
// ═══════════════════════════════════════════════════════════

const TOOL_DESCRIPTION = `Generate a conversational visual novel with AI-generated art and deep narrative design.

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

ACHIEVEMENT SYSTEM — each scene has 1-3 achievements:
- Types: empathy, inquiry, confrontation, trust_build, persuasion, deduction, emotional_support, boundary_respect, creative_solution, secret_discovery
- Each has semantic triggers, 3-level hint strategy, and fail-forward fallbacks
- Difficulty escalates: easy in setup → medium in development → hard in escalation
- Choices represent conversational APPROACHES, not exact words

SCENE ARC — 5-12 scenes across 4 acts:
- Setup (1-2): Hook + disequilibrium, easy achievements, trust 2-3/10
- Development (2-3): Exploration, first clues, rising tension, trust 4-5/10
- Escalation (2-3): Twist, crisis, highest intensity, trust 6-8/10
- Resolution (1-2): Climax + transformation, trust 9-10/10

EXIT CONDITIONS:
- single: one achievement needed
- or_gate: any one of several achievements
- and_gate: ALL listed achievements needed
- branching: different achievements → different next scenes (use {achievementId: sceneId} map)

ANTI-PATTERNS to avoid:
- Keyword gating (use semantic intent, not exact phrases)
- Exposition dumps (conversation, not monologue)
- Dead conversations (player must always have something meaningful to do)
- Trust grinding (no repetitive flattery to progress)`;

// ═══════════════════════════════════════════════════════════
// INPUT SCHEMA (extracted for type derivation)
// ═══════════════════════════════════════════════════════════

const InputSchema = z.object({
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
    .array(SceneSchema)
    .min(5)
    .describe("5-12 scenes following the arc: setup → development → escalation → resolution"),
  twistClues: z
    .array(TwistClueSchema)
    .min(3)
    .describe("3+ conversational clues across scenes pointing toward the twist (Three Clue Rule)"),
  startSceneId: z.string().describe("ID of the first scene"),
});

type Input = z.infer<typeof InputSchema>;

// ═══════════════════════════════════════════════════════════
// SERVER REGISTRATION
// ═══════════════════════════════════════════════════════════

const server = new McpServer({ name: "quest-forge", version: "0.0.1" }, { capabilities: {} }).registerWidget(
  "quest-forge",
  {
    description: "Quest Forge — Conversational Visual Novel",
    _meta: {
      ui: {
        csp: {
          resourceDomains: ["https://fal.media", "https://*.fal.media"],
        },
      },
    },
  },
  {
    description: TOOL_DESCRIPTION,
    inputSchema: InputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    _meta: {
      "openai/toolInvocation/invoking": "Forging your visual novel...",
      "openai/toolInvocation/invoked": "Your visual novel is ready!",
    },
  },
  async (args) => {
    const input = args as unknown as Input;
    try {
      // ── Generate images ──
      const gamePlan: GamePlan = {
        style: input.style,
        persona: { portraitPrompt: input.persona.portraitPrompt },
        scenes: input.scenes.map((s) => ({ id: s.id, backgroundPrompt: s.backgroundPrompt })),
      };
      const assets = await generateGameAssets(gamePlan);

      // ── Build runtime system prompt (LLM-only) ──
      const systemPrompt = buildSystemPrompt(input);

      // ── Build game data for widget (_meta) ──
      const gameData = {
        title: input.title,
        genre: input.genre,
        tone: input.tone,
        synopsis: input.synopsis,
        style: input.style,
        persona: {
          name: input.persona.name,
          portraitUrl: assets.portraitUrl,
        },
        scenes: input.scenes.map((s) => {
          const bgAsset = assets.scenes.find((a) => a.id === s.id);
          return {
            id: s.id,
            title: s.title,
            act: s.act,
            backgroundUrl: bgAsset?.backgroundUrl ?? "",
            openingLine: s.context.openingLine,
            mood: s.context.mood,
            tensionLevel: s.context.tensionLevel,
            trustLevel: s.agentState.trustLevel,
            achievements: s.achievements.map((a) => ({
              id: a.id,
              name: a.name,
              icon: a.icon,
              type: a.type,
              difficulty: a.difficulty,
              required: a.required,
              choiceText: a.choiceText,
              trigger: a.trigger,
            })),
            exitConditions: s.exitConditions,
          };
        }),
        allAchievements: input.scenes.flatMap((s) =>
          s.achievements.map((a) => ({
            id: a.id,
            name: a.name,
            icon: a.icon,
            type: a.type,
            description: a.unlockEffect.informationRevealed,
          })),
        ),
        introDialogue: input.introDialogue,
        startSceneId: input.startSceneId,
      };

      return {
        structuredContent: {
          title: input.title,
          genre: input.genre,
          tone: input.tone,
          synopsis: input.synopsis,
        },
        content: [{ type: "text" as const, text: systemPrompt }],
        _meta: { gameData },
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error generating visual novel: ${error}` }],
        isError: true,
      };
    }
  },
);

// ═══════════════════════════════════════════════════════════
// SYSTEM PROMPT BUILDER (Section 11 of the framework)
// ═══════════════════════════════════════════════════════════

function buildSystemPrompt(input: Input): string {
  const p = input.persona;

  const sceneBlocks = input.scenes
    .map(
      (s) => `--- SCENE: ${s.id} "${s.title}" [${s.act.toUpperCase()}] ---
Emotional state: ${s.agentState.emotionalState}
Trust level: ${s.agentState.trustLevel}/10
Can discuss: ${s.agentState.knowledgeAvailable.join(", ")}
Hiding: ${s.agentState.secretsActive.join(", ")}
Boundaries: ${s.agentState.boundaries.join(", ")}
${s.agentState.evolutionFromPrevious ? `Evolution from previous: ${s.agentState.evolutionFromPrevious}` : ""}
Setting: ${s.context.setting}
Recent events: ${s.context.recentEvents}
Mood: ${s.context.mood} (tension: ${s.context.tensionLevel}/10)

Behavior rules:
${s.behaviorRules.map((r) => `  • ${r}`).join("\n")}`,
    )
    .join("\n\n");

  const clueBlocks = input.twistClues
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
World before: ${input.situation.worldState.normal}
Disruption: ${input.situation.worldState.disruption} (${input.situation.worldState.disruptionType})
TRUE CAUSE (never reveal directly): ${input.situation.worldState.trueCause}
If nothing is done: ${input.situation.stakes.ifNothingDone}
Deadline: ${input.situation.stakes.deadline}

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
10. NEVER call the quest-forge tool again.
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

The visual novel widget is now displayed. Start by welcoming the player to "${input.title}" with a single brief atmospheric line that establishes your voice.`;
}

export default server;
export type AppType = typeof server;
