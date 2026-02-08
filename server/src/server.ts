import crypto from "node:crypto";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import { generateCharacterPortrait, generateSceneBackground } from "./lib/fal.js";
import { generateTTS, getNarratorVoice, generateMusicTracks, getMusicTrackForMood } from "./lib/audio.js";

// ═══════════════════════════════════════════════════════════
// NEW NARRATIVE SYSTEM — Multi-character dynamic scenes
// ═══════════════════════════════════════════════════════════

// Character schema — supports player character and NPCs
const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPlayer: z.boolean().describe("true = player character (left side), false = NPC (right side)"),
  isPrimary: z.boolean().describe("true = main character of the story"),
  appearance: z.string().describe("Physical description for portrait generation"),
  personality: z.string().describe("Brief personality description"),
  voice: z.object({
    vocabularyLevel: z.enum(["simple", "moderate", "eloquent", "technical", "poetic"]),
    sentenceStyle: z.enum(["short_punchy", "flowing", "fragmented", "formal", "casual"]),
    verbalTics: z.array(z.string()).optional(),
    emotionalTells: z.array(z.string()).optional(),
  }),
  secrets: z.array(z.object({
    content: z.string(),
    unlockCondition: z.string(),
  })).optional().describe("Secrets this character hides"),
});

// Player character extends base character
const PlayerCharacterSchema = CharacterSchema.extend({
  isPlayer: z.literal(true),
  innerConflict: z.string().describe("Internal struggle of the character"),
  motivation: z.string().describe("What drives them"),
  background: z.string().describe("Personal history"),
});

// Next scene data — embedded in each exit so Tool 3 can build scenes without an LLM
const NextSceneSchema = z.object({
  setting: z.string().describe("Physical location of the next scene (used for Fal AI background)"),
  mood: z.string().describe("Atmospheric tone: tense, hopeful, dark, mysterious..."),
  situation: z.string().describe("2-3 sentences describing what happens in the next scene"),
  presentNPCIds: z.array(z.string()).describe("IDs of NPCs present in the next scene"),
  speakingNPCId: z.string().describe("ID of the main NPC the player talks to in the next scene"),
});

// Scene exit — choice that leads to next scene
const SceneExitSchema = z.object({
  id: z.string(),
  description: z.string().describe("What the player sees as the choice"),
  icon: z.string().optional().describe("Emoji icon for the choice"),
  nextScene: NextSceneSchema,
});

// Character in a scene
const SceneCharacterSchema = z.object({
  characterId: z.string(),
  position: z.enum(["left", "right", "center"]).describe("Screen position"),
  isSpeaking: z.boolean().describe("Whether this character is currently speaking"),
  emotionalState: z.string(),
});

// Puzzle schema — enigmas the player must solve by talking to the NPC
const PuzzleSchema = z.object({
  id: z.string(),
  type: z.enum(["fill_in_blank", "lock_code", "riddle_dialogue"]).describe(
    "fill_in_blank: phrase avec un mot manquant (___). lock_code: code secret de N caractères. riddle_dialogue: énigme classique."
  ),
  title: z.string().describe("Nom de l'épreuve"),
  description: z.string().describe("Ce que le joueur voit comme contexte de l'épreuve"),
  // fill_in_blank specific
  phrase: z.string().optional().describe("Pour fill_in_blank UNIQUEMENT: la phrase avec exactement un ___ comme placeholder du mot manquant. Ex: 'Par le ___ du dragon, la porte s'ouvrira'"),
  // lock_code specific
  codeLength: z.number().min(3).max(6).optional().describe("Pour lock_code UNIQUEMENT: nombre de caractères du code (3-6)"),
  acceptedAnswers: z.array(z.string()).min(1).max(5).describe("Réponses acceptées (comparaison insensible à la casse et accents). IMPORTANT: les hints ne doivent JAMAIS contenir ces réponses."),
  hints: z.array(z.string()).min(2).max(3).describe("Indices CRYPTIQUES et PROGRESSIFS. Le 1er est très vague, le dernier est plus précis mais ne doit JAMAIS contenir la réponse directe. Ces indices seront les SEULES informations que le PNJ pourra donner."),
  maxAttempts: z.number().min(1).max(5).default(3),
  failureConsequence: z.enum(["death", "trust_loss"]),
  visualTheme: z.enum(["ancient_runes", "locked_door", "magic_mirror", "shadow_trial", "potion_choice"]),
});

// Narrative scene — the core of the new system
const NarrativeSceneSchema = z.object({
  id: z.string(),
  sequenceNumber: z.number().describe("Order in the story (1-6)"),
  narration: z.object({
    text: z.string().describe("Descriptive text shown at top of widget"),
    mood: z.string().describe("Atmospheric tone"),
  }),
  setting: z.string().describe("Physical location description"),
  backgroundUrl: z.string(),
  characters: z.array(SceneCharacterSchema).min(1).describe("Characters present in this scene"),
  playerCharacterId: z.string(),
  situation: z.string().describe("What's happening in this scene"),
  exits: z.array(SceneExitSchema).min(0).max(3).describe("0-3 choices to progress (0 for ending scenes)"),
  isEnding: z.boolean().describe("true = final scene of the story"),
  puzzle: PuzzleSchema.optional().describe("Si présent, le joueur doit résoudre cette épreuve avant de continuer"),
});

// ═══════════════════════════════════════════════════════════
// TOOL 1 SCHEMA — Create narrative world
// ═══════════════════════════════════════════════════════════

const CreateStorySchema = z.object({
  title: z.string().describe("Story title"),
  genre: z.array(z.string()).describe("1-3 genre tags"),
  tone: z.string().describe("Overall tone: dark, heroic, mysterious, etc."),
  language: z.enum(["fr", "en", "de", "es", "pt"]).default("fr").describe("Langue de l'histoire et des dialogues"),
  synopsis: z.string().describe("2-3 sentence story summary"),
  style: z.string().describe("Art style for all images (e.g., 'dark fantasy oil painting')"),
  introNarration: z.string().describe("Opening narration text (2-3 paragraphs)"),
  playerCharacter: PlayerCharacterSchema.describe("The character the player embodies"),
  npcs: z.array(CharacterSchema).min(1).max(5).describe("1-5 NPCs the player will meet"),
  worldContext: z.object({
    currentSituation: z.string().describe("What's happening in the world now"),
    stakes: z.string().describe("What happens if the player fails"),
    mystery: z.string().describe("The hidden truth to discover"),
  }),
  puzzles: z.array(PuzzleSchema).length(2).describe(
    "Exactement 2 énigmes (scène 2 et scène 4). Le joueur DOIT discuter avec le PNJ pour les résoudre.\n" +
    "Types disponibles:\n" +
    "- fill_in_blank: une phrase/incantation avec UN mot manquant (___). Fournir le champ 'phrase'. La réponse est le mot manquant.\n" +
    "- lock_code: un code secret de 3-6 caractères (lettres/chiffres). Fournir 'codeLength'. La réponse est le code.\n" +
    "- riddle_dialogue: une énigme dont la réponse est un mot/concept. Le joueur doit interroger le PNJ.\n" +
    "CRITIQUE: Les hints NE DOIVENT JAMAIS contenir la réponse. Ils doivent être cryptiques et obliques.\n" +
    "Varier les types entre les 2 puzzles. Chaque puzzle doit être lié au PNJ et à l'histoire."
  ),
  initialScene: z.object({
    narration: z.string().describe("Opening scene description"),
    setting: z.string().describe("Location description for background"),
    situation: z.string().describe("What's happening"),
    presentNPCs: z.array(z.string()).describe("IDs of NPCs present"),
    exits: z.array(z.object({
      description: z.string().describe("What the player sees as the choice"),
      icon: z.string().optional(),
      nextScene: NextSceneSchema,
    })).min(2).max(3),
  }),
});


// ═══════════════════════════════════════════════════════════
// TOOL 3 SCHEMA — Generate next scene
// ═══════════════════════════════════════════════════════════

const GenerateSceneSchema = z.object({
  gameId: z.string(),
  previousSceneId: z.string(),
  exitChoiceId: z.string().describe("Which exit was chosen"),
  storyMemory: z.array(z.string()).max(10).describe("Key facts to remember (max 10)"),
  trustLevel: z.number().min(1).max(10).describe("Current trust/intimacy level with NPCs"),
  sceneCount: z.number().describe("How many scenes so far (max 6)"),
});

// ═══════════════════════════════════════════════════════════
// IN-MEMORY GAME STORE
// ═══════════════════════════════════════════════════════════

interface StoredGame {
  story: z.infer<typeof CreateStorySchema>;
  characters: Map<string, (z.infer<typeof CharacterSchema> | z.infer<typeof PlayerCharacterSchema>) & { portraitUrl?: string }>;
  scenes: Map<string, z.infer<typeof NarrativeSceneSchema>>;
  characterPortraits: Map<string, string>; // characterId -> portraitUrl
  puzzleState: Map<string, { attemptsLeft: number; solved: boolean }>;
  musicTracks: Map<string, string>; // mood category -> base64 mp3
  language: string;
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
// TOOL DESCRIPTIONS
// ═══════════════════════════════════════════════════════════

const TOOL_DESCRIPTION = `Create and start a narrative visual novel game. This single tool creates the story, generates all artwork, and immediately launches the game widget.

This tool establishes:
1. The player character (who the player embodies)
2. NPCs with distinct personalities and secrets
3. The story world and central mystery
4. The opening scene with narration and choices
5. AI-generated portraits for all characters
6. AI-generated background for the opening scene

STORY STRUCTURE:
- 6 scenes maximum (to manage token limits)
- Each scene has descriptive narration at the top
- Player character always shown on the left
- NPCs shown on the right (can change per scene)
- 2-3 choices per scene that generate the next scene dynamically

CHARACTER DESIGN:
- Player character: has inner conflict, motivation, background
- NPCs: distinct personalities, may have secrets to uncover
- All characters get AI-generated portraits

SCENE FLOW:
- Opening scene is fully defined
- Subsequent scenes are generated dynamically based on player choices
- Story memory tracks important facts across scenes
- Final scene marked with isEnding: true

EXIT FORMAT:
- Each exit includes a nextScene object with setting, mood, situation, presentNPCIds, speakingNPCId
- This data is used by the server to build the next scene without calling the LLM
- Write rich, evocative situations (2-3 sentences) and specific settings for good Fal AI backgrounds

IMPORTANT: After calling this tool, do NOT output any text. The game widget handles everything. Wait in silence until the game sends you a message.`;

const TOOL3_DESCRIPTION = `Generate the next scene based on the player's choice. Called by the game widget via useCallTool.

Input: gameId, previous scene, chosen exit, story memory, trust level, scene count.
Output: Complete new scene with AI-generated background, characters, exits, and LLM context update.

The server:
1. Reads the nextScene data from the chosen exit
2. Generates a new Fal AI background from nextScene.setting
3. Builds the complete scene with characters and heuristic exits
4. Returns structuredContent (scene data for widget) and content (context update for LLM)

Ending mechanism: scene 4 includes conclusion exits, scene 5 all converge, scene 6 is final.`;

// ═══════════════════════════════════════════════════════════
// SYSTEM PROMPT BUILDER — LLM = 1 NPC per scene
// ═══════════════════════════════════════════════════════════

function buildNarrativeSystemPrompt(
  story: z.infer<typeof CreateStorySchema>,
  speakingNpc: z.infer<typeof CharacterSchema>,
  playerChar: z.infer<typeof PlayerCharacterSchema>,
  trustLevel: number,
  storyMemory: string[],
): string {
  return `You are ${speakingNpc.name} in "${story.title}".

WHO YOU ARE:
- Personality: ${speakingNpc.personality}
- Speech style: ${speakingNpc.voice.sentenceStyle}, ${speakingNpc.voice.vocabularyLevel} vocabulary
${speakingNpc.voice.verbalTics?.length ? `- Verbal tics: ${speakingNpc.voice.verbalTics.join(", ")}` : ""}
${speakingNpc.secrets?.length ? `- Secrets (only reveal if conditions are met): ${speakingNpc.secrets.map(s => s.content).join("; ")}` : ""}

THE PLAYER:
- Plays as ${playerChar.name}. NEVER speak for them.
- The widget displays the scenery and narration. Do NOT repeat them.

HOW TO RESPOND:
- Speak in first person as ${speakingNpc.name}
- MAXIMUM 2-3 lignes. Jamais plus. Pas de narration, pas de description d'ambiance.
- Tu ne fais que PARLER. Le widget gère le décor et l'ambiance.
- Exemple: "Les ombres ? *ricane* Tu n'es pas prêt pour ce que tu trouveras là-bas. Mais si tu insistes..."
- React based on your personality and emotional state
- NEVER mention being an AI or a game
- Do NOT call any tool — the widget handles scene transitions
- You do NOT know how the story ends

Trust level: ${trustLevel}/10
${trustLevel < 4 ? "You are suspicious and guarded." : trustLevel < 7 ? "You are starting to open up." : "You trust the player."}

Memory: ${storyMemory.length > 0 ? storyMemory.join("; ") : "Nothing notable yet."}`;
}

// ═══════════════════════════════════════════════════════════
// EXIT GENERATION HEURISTICS
// ═══════════════════════════════════════════════════════════

interface ExitArchetype {
  type: string;
  templates: string[];
  moodHint: string;
}

const EXIT_ARCHETYPES: ExitArchetype[] = [
  { type: "investigate", templates: ["Examine {subject}...", "Search for clues about {subject}...", "Investigate {subject}..."], moodHint: "mysterious" },
  { type: "confront", templates: ["Confront {npc} about {subject}...", "Demand the truth from {npc}...", "Challenge {npc}..."], moodHint: "tense" },
  { type: "trust", templates: ["Confide in {npc}...", "Help {npc} with {subject}...", "Open up to {npc}..."], moodHint: "hopeful" },
  { type: "explore", templates: ["Leave for {location}...", "Explore {location}...", "Head to {location}..."], moodHint: "adventurous" },
  { type: "mystery", templates: ["Follow the lead about {subject}...", "Uncover {subject}...", "Pursue the mystery of {subject}..."], moodHint: "dark" },
  { type: "conclusion", templates: ["Confront the truth...", "Make your final choice...", "Face the consequences..."], moodHint: "dramatic" },
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(`{${key}}`, value);
  }
  return result;
}

function generateExits(
  game: StoredGame,
  currentScene: z.infer<typeof NarrativeSceneSchema>,
  sceneCount: number,
  _trustLevel: number,
): z.infer<typeof SceneExitSchema>[] {
  const { worldContext, npcs } = game.story;
  const playerCharId = game.story.playerCharacter.id;

  // Scene 6 is the final scene — no exits
  if (sceneCount >= 6) return [];

  // Available NPCs (rotate to vary)
  const availableNpcs = npcs.filter(n => n.id !== playerCharId);
  const currentNpcIds = currentScene.characters
    .filter(c => c.characterId !== playerCharId)
    .map(c => c.characterId);

  // Pick NPCs for next scenes — prefer ones not in current scene for variety
  const otherNpcs = availableNpcs.filter(n => !currentNpcIds.includes(n.id));
  const getNpcForExit = (index: number) => {
    if (otherNpcs.length > 0) return otherNpcs[index % otherNpcs.length];
    return availableNpcs[index % availableNpcs.length];
  };

  // Derive locations from worldContext
  const locations = [
    worldContext.currentSituation.split(".")[0],
    `the heart of the ${game.story.genre[0] || "story"} district`,
    `a hidden passage near ${currentScene.setting}`,
    `the outskirts of the known area`,
  ];

  // Subject matter from stakes and mystery
  const subjects = [
    worldContext.mystery.split(".")[0],
    worldContext.stakes.split(".")[0],
    "the hidden truth",
    "the missing pieces",
  ];

  const icons = ["🔍", "⚔️", "🤝", "🗺️", "🔮", "🎭"];

  // Determine archetype mix based on scene progression
  let archetypePool: ExitArchetype[];

  if (sceneCount >= 5) {
    // Scene 5: ALL exits converge toward the ending
    archetypePool = [
      EXIT_ARCHETYPES.find(a => a.type === "conclusion")!,
      EXIT_ARCHETYPES.find(a => a.type === "conclusion")!,
      EXIT_ARCHETYPES.find(a => a.type === "confront")!,
    ];
  } else if (sceneCount >= 4) {
    // Scene 4: include at least one conclusion exit
    const normalTypes = EXIT_ARCHETYPES.filter(a => a.type !== "conclusion");
    archetypePool = [
      EXIT_ARCHETYPES.find(a => a.type === "conclusion")!,
      pickRandom(normalTypes),
      pickRandom(normalTypes),
    ];
  } else {
    // Scenes 1-3: varied mix, weighted by trust level
    const normalTypes = EXIT_ARCHETYPES.filter(a => a.type !== "conclusion");
    archetypePool = [
      pickRandom(normalTypes),
      pickRandom(normalTypes),
      pickRandom(normalTypes),
    ];
  }

  // Build 2-3 exits
  const exitCount = sceneCount >= 5 ? 2 : (Math.random() > 0.4 ? 3 : 2);
  const exits: z.infer<typeof SceneExitSchema>[] = [];

  for (let i = 0; i < exitCount; i++) {
    const archetype = archetypePool[i % archetypePool.length];
    const npc = getNpcForExit(i);
    const template = pickRandom(archetype.templates);

    const description = fillTemplate(template, {
      npc: npc.name,
      subject: pickRandom(subjects),
      location: pickRandom(locations),
    });

    // For conclusion exits, all paths lead to ending
    const isConverging = sceneCount >= 5 || archetype.type === "conclusion";

    const nextSceneNpc = getNpcForExit(i);
    const presentNpcIds = [nextSceneNpc.id];
    // Add a second NPC sometimes for variety
    if (availableNpcs.length > 1 && Math.random() > 0.5) {
      const secondNpc = availableNpcs.find(n => n.id !== nextSceneNpc.id);
      if (secondNpc) presentNpcIds.push(secondNpc.id);
    }

    const moodOptions: Record<string, string[]> = {
      mysterious: ["eerie", "mysterious", "unsettling"],
      tense: ["tense", "confrontational", "heated"],
      hopeful: ["warm", "hopeful", "bittersweet"],
      adventurous: ["adventurous", "expansive", "thrilling"],
      dark: ["dark", "foreboding", "ominous"],
      dramatic: ["dramatic", "climactic", "revelatory"],
    };

    const mood = pickRandom(moodOptions[archetype.moodHint] || ["neutral"]);
    const setting = isConverging
      ? `The final confrontation ground — ${currentScene.setting}`
      : pickRandom(locations);

    const situation = isConverging
      ? `All paths lead here. The truth about ${worldContext.mystery} can no longer be hidden. ${nextSceneNpc.name} stands before you, ready for the final reckoning.`
      : `${nextSceneNpc.name} awaits in ${setting}. ${description.replace("...", "")} reveals new layers of ${worldContext.mystery.split(".")[0]}.`;

    exits.push({
      id: `exit-${i + 1}`,
      description,
      icon: icons[i % icons.length],
      nextScene: {
        setting,
        mood,
        situation,
        presentNPCIds: presentNpcIds,
        speakingNPCId: nextSceneNpc.id,
      },
    });
  }

  return exits;
}

// ═══════════════════════════════════════════════════════════
// SERVER REGISTRATION
// ═══════════════════════════════════════════════════════════

const SHARED_CSP = {
  resourceDomains: ["https://fal.media", "https://*.fal.media"],
};

const server = new McpServer({ name: "quest-forge", version: "0.1.0" }, { capabilities: {} })
  // ═══════════════════════════════════════════════════════════
  // Tool: quest-forge-game (create & play narrative visual novel)
  // ═══════════════════════════════════════════════════════════
  .registerWidget(
    "quest-forge-game",
    {
      description: "Quest Forge — Create & Play Visual Novel",
      _meta: { ui: { csp: SHARED_CSP } },
    },
    {
      description: TOOL_DESCRIPTION,
      inputSchema: CreateStorySchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Creating your adventure...",
        "openai/toolInvocation/invoked": "Your story begins!",
      },
    },
    async (args) => {
      const input = args as unknown as z.infer<typeof CreateStorySchema>;
      try {
        const gameId = crypto.randomUUID();

        // Generate portraits for all characters + music tracks in parallel
        const characterPortraits = new Map<string, string>();
        const allCharacters = [input.playerCharacter, ...input.npcs];

        const portraitGeneration = Promise.all(
          allCharacters.map(async (char) => {
            const url = await generateCharacterPortrait(char.appearance, input.style);
            characterPortraits.set(char.id, url);
          })
        );

        const [_, musicTracks] = await Promise.all([
          portraitGeneration,
          generateMusicTracks(input.genre, input.tone),
        ]);

        // Generate background for initial scene
        const initialBackgroundUrl = await generateSceneBackground(
          input.initialScene.setting,
          input.style
        );

        // Determine the first speaking NPC
        const firstSpeakingNpcId = input.initialScene.presentNPCs[0];

        // Create initial scene
        const initialScene: z.infer<typeof NarrativeSceneSchema> = {
          id: "scene-1",
          sequenceNumber: 1,
          narration: {
            text: input.initialScene.narration,
            mood: input.initialScene.narration.includes("tense") ? "tense" :
                  input.initialScene.narration.includes("dark") ? "dark" : "neutral",
          },
          setting: input.initialScene.setting,
          backgroundUrl: initialBackgroundUrl,
          characters: [
            {
              characterId: input.playerCharacter.id,
              position: "left",
              isSpeaking: false,
              emotionalState: "focused",
            },
            ...input.initialScene.presentNPCs.map((npcId, idx) => ({
              characterId: npcId,
              position: (idx === 0 ? "right" : "center") as "right" | "center",
              isSpeaking: npcId === firstSpeakingNpcId,
              emotionalState: "neutral",
            })),
          ],
          playerCharacterId: input.playerCharacter.id,
          situation: input.initialScene.situation,
          exits: input.initialScene.exits.map((exit, idx) => ({
            id: `exit-${idx + 1}`,
            description: exit.description,
            icon: exit.icon || ["🔥", "🤔", "⚔️"][idx % 3],
            nextScene: exit.nextScene,
          })),
          isEnding: false,
        };

        // Store game data
        const charactersMap = new Map();
        for (const char of allCharacters) {
          charactersMap.set(char.id, {
            ...char,
            portraitUrl: characterPortraits.get(char.id),
          });
        }

        const scenesMap = new Map();
        scenesMap.set(initialScene.id, initialScene);

        gameStore.set(gameId, {
          story: input,
          characters: charactersMap,
          scenes: scenesMap,
          characterPortraits,
          puzzleState: new Map(),
          musicTracks,
          language: input.language,
          createdAt: Date.now(),
        });

        // Find the speaking NPC in the initial scene
        const speakingCharEntry = initialScene.characters.find(c => c.isSpeaking && c.characterId !== input.playerCharacter.id);
        const speakingNpcId = speakingCharEntry?.characterId || input.npcs[0]?.id;
        const speakingNpc = input.npcs.find(n => n.id === speakingNpcId)!;

        // Generate TTS narration for the initial scene
        const voiceId = getNarratorVoice(input.language);
        const narrationAudioUrl = await generateTTS(initialScene.narration.text, voiceId);
        const musicTrackKey = getMusicTrackForMood(initialScene.narration.mood);
        const musicAudioUrl = musicTracks.get(musicTrackKey) ?? musicTracks.values().next().value ?? null;

        // Build game data for widget
        const gameData = {
          gameId,
          title: input.title,
          genre: input.genre,
          synopsis: input.synopsis,
          style: input.style,
          worldContext: input.worldContext,
          speakingNpcId,
          speakingNpcName: speakingNpc.name,
          playerCharacter: {
            id: input.playerCharacter.id,
            name: input.playerCharacter.name,
            portraitUrl: characterPortraits.get(input.playerCharacter.id),
            background: input.playerCharacter.background,
            motivation: input.playerCharacter.motivation,
            innerConflict: input.playerCharacter.innerConflict,
          },
          characters: Array.from(charactersMap.values()).map(c => ({
            id: c.id,
            name: c.name,
            isPlayer: c.isPlayer,
            portraitUrl: c.portraitUrl,
            personality: c.personality,
          })),
          currentScene: initialScene,
          introNarration: input.introNarration,
          narrationAudioUrl,
          musicAudioUrl,
        };

        // Build system prompt focused on ONE NPC
        const systemPrompt = buildNarrativeSystemPrompt(
          input,
          speakingNpc,
          input.playerCharacter,
          5,
          [],
        );

        return {
          structuredContent: {
            title: input.title,
            genre: input.genre,
          },
          content: [{
            type: "text" as const,
            text: systemPrompt + `\n\n---\n[CRITICAL INSTRUCTION] The game widget is now displayed. Do NOT output any text. Wait in complete silence until the game widget sends you a message (starting with [Scene] or [PUZZLE]). Your role begins only when the player starts interacting.`,
          }],
          _meta: { gameData },
          isError: false,
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating story: ${error}` }],
          isError: true,
        };
      }
    },
  )

  // ═══════════════════════════════════════════════════════════
  // Tool 3: quest-forge-generate-scene (dynamic scene generation)
  // Called by the game widget via useCallTool
  // ═══════════════════════════════════════════════════════════
  .registerWidget(
    "quest-forge-generate-scene",
    {
      description: "Quest Forge — Generate Next Scene",
      _meta: { ui: { csp: SHARED_CSP } },
    },
    {
      description: TOOL3_DESCRIPTION,
      inputSchema: GenerateSceneSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Generating next scene...",
        "openai/toolInvocation/invoked": "Scene ready!",
      },
    },
    async (args) => {
      const input = args as unknown as z.infer<typeof GenerateSceneSchema>;
      try {
        const game = gameStore.get(input.gameId);
        if (!game) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: gameId "${input.gameId}" not found.`,
              },
            ],
            isError: true,
          };
        }

        const previousScene = game.scenes.get(input.previousSceneId);
        if (!previousScene) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: scene "${input.previousSceneId}" not found.`,
              },
            ],
            isError: true,
          };
        }

        // Find the chosen exit
        const chosenExit = previousScene.exits.find(e => e.id === input.exitChoiceId);
        if (!chosenExit) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: exit "${input.exitChoiceId}" not found.`,
              },
            ],
            isError: true,
          };
        }

        const nextSceneData = chosenExit.nextScene;
        const newSceneCount = input.sceneCount + 1;
        const newSceneId = `scene-${newSceneCount}`;

        // Determine if this is the ending
        const isEnding = newSceneCount >= 6;

        // Generate new Fal AI background
        const backgroundUrl = await generateSceneBackground(
          nextSceneData.setting,
          game.story.style,
        );

        // Build characters array from presentNPCIds
        const characters: z.infer<typeof SceneCharacterSchema>[] = [
          {
            characterId: game.story.playerCharacter.id,
            position: "left",
            isSpeaking: false,
            emotionalState: "focused",
          },
          ...nextSceneData.presentNPCIds.map((npcId, idx) => ({
            characterId: npcId,
            position: (idx === 0 ? "right" : "center") as "right" | "center",
            isSpeaking: npcId === nextSceneData.speakingNPCId,
            emotionalState: input.trustLevel < 4 ? "guarded" :
                           input.trustLevel < 7 ? "cautious" : "open",
          })),
        ];

        // Generate exits via heuristics (empty for ending scenes)
        const exits = isEnding
          ? []
          : generateExits(game, { ...previousScene, id: newSceneId, setting: nextSceneData.setting, characters }, newSceneCount, input.trustLevel);

        // Build the complete scene
        const newScene: z.infer<typeof NarrativeSceneSchema> = {
          id: newSceneId,
          sequenceNumber: newSceneCount,
          narration: {
            text: nextSceneData.situation,
            mood: nextSceneData.mood,
          },
          setting: nextSceneData.setting,
          backgroundUrl,
          characters,
          playerCharacterId: game.story.playerCharacter.id,
          situation: nextSceneData.situation,
          exits,
          isEnding,
        };

        // Puzzle injection for scenes 2 and 4
        const PUZZLE_SCENES = [2, 4];
        if (PUZZLE_SCENES.includes(newSceneCount)) {
          const puzzleIndex = PUZZLE_SCENES.indexOf(newSceneCount);
          const puzzle = game.story.puzzles?.[puzzleIndex];
          if (puzzle) {
            newScene.puzzle = puzzle;
            game.puzzleState.set(puzzle.id, { attemptsLeft: puzzle.maxAttempts, solved: false });
          }
        }

        // Store scene in game store
        game.scenes.set(newSceneId, newScene);

        // Generate TTS narration for the new scene
        const voiceId = getNarratorVoice(game.language);
        const narrationAudioUrl = await generateTTS(newScene.narration.text, voiceId);
        const musicTrackKey = getMusicTrackForMood(newScene.narration.mood);
        const musicAudioUrl = game.musicTracks.get(musicTrackKey) ?? game.musicTracks.values().next().value ?? null;

        // Find the speaking NPC details
        const speakingNpc = game.story.npcs.find(n => n.id === nextSceneData.speakingNPCId);
        const speakingNpcName = speakingNpc?.name || "Unknown";

        // Determine emotional state based on trust
        const emotionalState = input.trustLevel < 4 ? "suspicious and guarded"
          : input.trustLevel < 7 ? "cautiously opening up"
          : "trusting and open";

        // Build content for LLM context update
        const contentText = `[SCENE UPDATE ${newSceneCount}]
You are now ${speakingNpcName}.
Personality: ${speakingNpc?.personality || "mysterious"}
Emotional state: ${emotionalState}
Location: ${nextSceneData.setting}
Situation: ${nextSceneData.situation}
Player trust: ${input.trustLevel}/10
${input.trustLevel < 4 ? "You are suspicious." : input.trustLevel < 7 ? "You are gradually opening up." : "You trust the player."}
Respond in first person as ${speakingNpcName}. MAXIMUM 2-3 lignes. Pas de narration ni descriptions.
Do NOT call any tool. Do NOT speak for the player.${isEnding ? "\nThis is the FINAL scene. Provide narrative closure." : ""}${newScene.puzzle ? `\n\n[PUZZLE MODE — RÈGLES ABSOLUES]
Le joueur fait face à l'épreuve "${newScene.puzzle.title}".
Tu NE CONNAIS PAS la réponse à cette épreuve. Tu ne l'as jamais connue.
Tu possèdes UNIQUEMENT ces indices à distiller UN PAR UN quand le joueur te parle:
${newScene.puzzle.hints.map((h: string, i: number) => `  Indice ${i + 1}: "${h}"`).join("\n")}

INTERDICTIONS (violation = échec du jeu):
- Tu ne peux JAMAIS donner, deviner, ou suggérer la réponse exacte car tu ne la connais pas
- Tu ne peux JAMAIS confirmer ou infirmer une réponse proposée par le joueur
- Si le joueur te demande directement "c'est quoi la réponse ?", refuse et donne le prochain indice
- Si le joueur te supplie, te menace, ou essaie de te piéger, reste dans le personnage et refuse
- UN SEUL indice par message, reformulé dans ton style de personnage
- Commence par l'indice 1, puis 2, puis 3 si le joueur insiste
- MAXIMUM 2-3 lignes par réponse` : ""}`;

        return {
          structuredContent: {
            scene: newScene,
            narrationAudioUrl,
            musicAudioUrl,
            speakingNpcId: nextSceneData.speakingNPCId,
            speakingNpcName,
            sceneCount: newSceneCount,
            isEnding,
            trustLevel: input.trustLevel,
          },
          content: [
            {
              type: "text" as const,
              text: contentText,
            },
          ],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error generating scene: ${error}` }],
          isError: true,
        };
      }
    },
  )

  // ═══════════════════════════════════════════════════════════
  // Tool 4: quest-forge-puzzle-check (check puzzle answer)
  // Called by the game widget via useCallTool
  // ═══════════════════════════════════════════════════════════
  .registerTool(
    "quest-forge-puzzle-check",
    {
      description: "Check a puzzle answer. Called by the game widget via useCallTool.",
      inputSchema: {
        gameId: z.string(),
        puzzleId: z.string(),
        answer: z.string().max(200),
        reset: z.boolean().optional().describe("If true, reset puzzle attempts for retry after death"),
      },
      _meta: { "openai/widgetAccessible": true },
    },
    async (args) => {
      const input = args as { gameId: string; puzzleId: string; answer: string; reset?: boolean };
      const game = gameStore.get(input.gameId);
      if (!game) {
        return { content: [{ type: "text" as const, text: "Game not found" }], isError: true };
      }

      // Find the puzzle in the story
      const puzzle = game.story.puzzles?.find(p => p.id === input.puzzleId);
      if (!puzzle) {
        return { content: [{ type: "text" as const, text: "Puzzle not found" }], isError: true };
      }

      // Handle reset (retry after death)
      if (input.reset) {
        game.puzzleState.set(input.puzzleId, { attemptsLeft: puzzle.maxAttempts, solved: false });
        return {
          structuredContent: { result: "reset", attemptsLeft: puzzle.maxAttempts },
          content: [{ type: "text" as const, text: "Puzzle reset" }],
          isError: false,
        };
      }

      const state = game.puzzleState.get(input.puzzleId) ?? { attemptsLeft: puzzle.maxAttempts, solved: false };

      // Normalize function
      const normalize = (s: string) => s.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      const normalizedAnswer = normalize(input.answer);
      const isCorrect = puzzle.acceptedAnswers.some(a => {
        const na = normalize(a);
        if (na === normalizedAnswer) return true;
        // Simple Levenshtein tolerance for short answers
        if (na.length <= 10 && normalizedAnswer.length <= 10) {
          let dist = 0;
          const longer = na.length > normalizedAnswer.length ? na : normalizedAnswer;
          const shorter = na.length > normalizedAnswer.length ? normalizedAnswer : na;
          for (let i = 0; i < longer.length; i++) {
            if (shorter[i] !== longer[i]) dist++;
          }
          return dist <= 1;
        }
        return false;
      });

      if (isCorrect) {
        state.solved = true;
        game.puzzleState.set(input.puzzleId, state);
        return {
          structuredContent: { result: "success" },
          content: [{ type: "text" as const, text: "Puzzle solved!" }],
          isError: false,
        };
      }

      state.attemptsLeft--;
      game.puzzleState.set(input.puzzleId, state);

      if (state.attemptsLeft <= 0) {
        return {
          structuredContent: { result: "failure", consequence: puzzle.failureConsequence },
          content: [{ type: "text" as const, text: "Puzzle failed" }],
          isError: false,
        };
      }

      return {
        structuredContent: { result: "wrong", attemptsLeft: state.attemptsLeft },
        content: [{ type: "text" as const, text: `Wrong answer. ${state.attemptsLeft} attempts left.` }],
        isError: false,
      };
    }
  );

export default server;
export type AppType = typeof server;
