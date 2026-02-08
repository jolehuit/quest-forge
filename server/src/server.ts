import crypto from "node:crypto";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import { generateCharacterPortrait, generateSceneBackground } from "./lib/fal.js";

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

// Scene exit — choice that leads to next scene
const SceneExitSchema = z.object({
  id: z.string(),
  description: z.string().describe("What the player sees as the choice"),
  prompt: z.string().describe("Prompt for generating the next scene"),
  icon: z.string().optional().describe("Emoji icon for the choice"),
});

// Character in a scene
const SceneCharacterSchema = z.object({
  characterId: z.string(),
  position: z.enum(["left", "right", "center"]).describe("Screen position"),
  isSpeaking: z.boolean().describe("Whether this character is currently speaking"),
  emotionalState: z.string(),
});

// Narrative scene — the core of the new system
const NarrativeSceneSchema = z.object({
  id: z.string(),
  sequenceNumber: z.number().describe("Order in the story (1-10)"),
  narration: z.object({
    text: z.string().describe("Descriptive text shown at top of widget"),
    mood: z.string().describe("Atmospheric tone"),
  }),
  setting: z.string().describe("Physical location description"),
  backgroundUrl: z.string(),
  characters: z.array(SceneCharacterSchema).min(1).describe("Characters present in this scene"),
  playerCharacterId: z.string(),
  situation: z.string().describe("What's happening in this scene"),
  exits: z.array(SceneExitSchema).min(2).max(3).describe("2-3 choices to progress"),
  isEnding: z.boolean().describe("true = final scene of the story"),
});

// ═══════════════════════════════════════════════════════════
// TOOL 1 SCHEMA — Create narrative world (NEW)
// ═══════════════════════════════════════════════════════════

const CreateStorySchema = z.object({
  title: z.string().describe("Story title"),
  genre: z.array(z.string()).describe("1-3 genre tags"),
  tone: z.string().describe("Overall tone: dark, heroic, mysterious, etc."),
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
  initialScene: z.object({
    narration: z.string().describe("Opening scene description"),
    setting: z.string().describe("Location description for background"),
    situation: z.string().describe("What's happening"),
    presentNPCs: z.array(z.string()).describe("IDs of NPCs present"),
    exits: z.array(z.object({
      description: z.string(),
      prompt: z.string().describe("How to generate the next scene based on this choice"),
      icon: z.string().optional(),
    })).min(2).max(3),
  }),
});

// ═══════════════════════════════════════════════════════════
// TOOL 2 SCHEMA — Start game (simplified)
// ═══════════════════════════════════════════════════════════

const StartGameSchema = z.object({
  gameId: z.string().describe("The gameId returned by quest-forge"),
});

// ═══════════════════════════════════════════════════════════
// TOOL 3 SCHEMA — Generate next scene (NEW)
// ═══════════════════════════════════════════════════════════

const GenerateSceneSchema = z.object({
  gameId: z.string(),
  previousSceneId: z.string(),
  exitChoiceId: z.string().describe("Which exit was chosen"),
  storyMemory: z.array(z.string()).max(10).describe("Key facts to remember (max 10)"),
  trustLevel: z.number().min(1).max(10).describe("Current trust/intimacy level with NPCs"),
  sceneCount: z.number().describe("How many scenes so far (max 10)"),
});

// ═══════════════════════════════════════════════════════════
// IN-MEMORY GAME STORE
// ═══════════════════════════════════════════════════════════

interface StoredGame {
  story: z.infer<typeof CreateStorySchema>;
  characters: Map<string, (z.infer<typeof CharacterSchema> | z.infer<typeof PlayerCharacterSchema>) & { portraitUrl?: string }>;
  scenes: Map<string, z.infer<typeof NarrativeSceneSchema>>;
  characterPortraits: Map<string, string>; // characterId -> portraitUrl
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

const TOOL1_DESCRIPTION = `Create a narrative visual novel with dynamic scene generation.

This tool establishes:
1. The player character (who the player embodies)
2. NPCs with distinct personalities and secrets
3. The story world and central mystery
4. The opening scene with narration and choices

STORY STRUCTURE:
- 10 scenes maximum (to manage token limits)
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
- Final scene marked with isEnding: true`;

const TOOL2_DESCRIPTION = `Start the visual novel game created with quest-forge.

Returns the initial scene data and system prompt for the LLM.
The widget will display:
- Narration text at the top
- Player character portrait on the left
- NPC portrait(s) on the right
- Choice buttons at the bottom

When the player makes a choice, call quest-forge-generate-scene to create the next scene.`;

const TOOL3_DESCRIPTION = `Generate the next scene dynamically based on the player's choice.

Input: gameId, previous scene, chosen exit, story memory
Output: Complete new scene with:
- Narration text
- Background image
- Characters present
- 2-3 new choices

The scene is generated by:
1. Creating narration text with LLM
2. Generating background image if setting is new
3. Determining which NPCs are present
4. Generating portraits for new NPCs
5. Creating 2-3 exit choices

If sceneCount >= 10 or the story naturally concludes, set isEnding: true.`;

// ═══════════════════════════════════════════════════════════
// SYSTEM PROMPT BUILDER (NEW)
// ═══════════════════════════════════════════════════════════

function buildNarrativeSystemPrompt(
  story: z.infer<typeof CreateStorySchema>,
  currentScene: z.infer<typeof NarrativeSceneSchema>,
  storyMemory: string[],
  trustLevel: number
): string {
  const playerChar = story.playerCharacter;
  const presentNPCs = currentScene.characters
    .filter(c => c.characterId !== playerChar.id)
    .map(c => story.npcs.find(n => n.id === c.characterId))
    .filter(Boolean);

  return `You are the narrator and voice of all NPCs in "${story.title}".

═══════════════════════════════════════
CURRENT SCENE CONTEXT
═══════════════════════════════════════
Narration: "${currentScene.narration.text}"
Mood: ${currentScene.narration.mood}
Setting: ${currentScene.setting}
Situation: ${currentScene.situation}

═══════════════════════════════════════
PLAYER CHARACTER (incarnated by the user)
═══════════════════════════════════════
Name: ${playerChar.name}
Background: ${playerChar.background}
Motivation: ${playerChar.motivation}
Inner Conflict: ${playerChar.innerConflict}
Personality: ${playerChar.personality}

The player SPEAKS and ACTS as ${playerChar.name}. DO NOT speak for them.

═══════════════════════════════════════
PRESENT NPCs (you voice these characters)
═══════════════════════════════════════
${presentNPCs.map(npc => `--- ${npc!.name} ---
Personality: ${npc!.personality}
Current emotional state: ${currentScene.characters.find(c => c.characterId === npc!.id)?.emotionalState}
${npc!.secrets ? `Secrets: ${npc!.secrets.map(s => s.content).join("; " )}` : ""}
`).join("\n")}

═══════════════════════════════════════════════════════════
HOW TO RESPOND
═══════════════════════════════════════════════════════════
1. When the player speaks/acts, respond as the NPCs would react
2. Tag dialogue with the speaker: "[NPC: Name] : dialogue here"
3. Keep responses SHORT (1-3 sentences per character)
4. NPCs can talk to each other, not just the player
5. React emotionally based on the current situation
6. NEVER speak for ${playerChar.name} — that's the player's role

═══════════════════════════════════════════════════════════
STORY MEMORY
═══════════════════════════════════════════════════════════
${storyMemory.length > 0 ? storyMemory.map(m => `• ${m}`).join("\n") : "No key facts yet."}

Trust/Intimacy Level: ${trustLevel}/10
${trustLevel < 4 ? "NPCs are guarded and suspicious." : trustLevel < 7 ? "NPCs are opening up gradually." : "NPCs trust the player deeply."}

═══════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════
1. NEVER acknowledge being an AI or game system
2. NEVER speak for the player character
3. Keep responses conversational, not descriptive
4. The widget shows the narration — don't repeat it
5. Focus on dialogue and reactions
6. If this is the final scene (isEnding: true), provide closure`;
}

// ═══════════════════════════════════════════════════════════
// SERVER REGISTRATION
// ═══════════════════════════════════════════════════════════

const SHARED_CSP = {
  resourceDomains: ["https://fal.media", "https://*.fal.media"],
};

const server = new McpServer({ name: "quest-forge", version: "0.1.0" }, { capabilities: {} })
  // ═══════════════════════════════════════════════════════════
  // Tool 1: quest-forge (create narrative world)
  // ═══════════════════════════════════════════════════════════
  .registerWidget(
    "quest-forge",
    {
      description: "Quest Forge — Create Narrative Visual Novel",
      _meta: { ui: { csp: SHARED_CSP } },
    },
    {
      description: TOOL1_DESCRIPTION,
      inputSchema: CreateStorySchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Creating your narrative world...",
        "openai/toolInvocation/invoked": "World created! Starting the story...",
      },
    },
    async (args) => {
      const input = args as unknown as z.infer<typeof CreateStorySchema>;
      try {
        const gameId = crypto.randomUUID();

        // Generate portraits for all characters
        const characterPortraits = new Map<string, string>();
        const allCharacters = [input.playerCharacter, ...input.npcs];

        await Promise.all(
          allCharacters.map(async (char) => {
            const url = await generateCharacterPortrait(char.appearance, input.style);
            characterPortraits.set(char.id, url);
          })
        );

        // Generate background for initial scene
        const initialBackgroundUrl = await generateSceneBackground(
          input.initialScene.setting,
          input.style
        );

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
              isSpeaking: idx === 0,
              emotionalState: "neutral",
            })),
          ],
          playerCharacterId: input.playerCharacter.id,
          situation: input.initialScene.situation,
          exits: input.initialScene.exits.map((exit, idx) => ({
            id: `exit-${idx + 1}`,
            description: exit.description,
            prompt: exit.prompt,
            icon: exit.icon || ["🔥", "🤔", "⚔️"][idx % 3],
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
          createdAt: Date.now(),
        });

        // Build preview data
        const previewData = {
          title: input.title,
          genre: input.genre,
          synopsis: input.synopsis,
          playerCharacter: {
            name: input.playerCharacter.name,
            portraitUrl: characterPortraits.get(input.playerCharacter.id),
          },
          initialScene: {
            narration: initialScene.narration.text,
            backgroundUrl: initialBackgroundUrl,
            presentNPCs: input.initialScene.presentNPCs.map(id => ({
              id,
              name: input.npcs.find(n => n.id === id)?.name,
              portraitUrl: characterPortraits.get(id),
            })),
          },
        };

        return {
          structuredContent: {
            gameId,
            title: input.title,
            genre: input.genre,
            synopsis: input.synopsis,
          },
          content: [
            {
              type: "text" as const,
              text: `🎮 **Votre histoire "${input.title}" est prête !**\n\n` +
                    `${allCharacters.length} personnages créés avec leurs portraits.\n\n` +
                    `**👉 Pour JOUER maintenant :**\n` +
                    `Cliquez sur le bouton **"🎮 JOUER À L'HISTOIRE"** dans le widget ci-dessus.\n\n` +
                    `**✏️ Ou pour continuer à éditer :**\n` +
                    `Dites-moi ce que vous voulez modifier (titre, personnages, scénario...) et je régénérerai l'histoire.`,
            },
          ],
          _meta: { previewData },
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
  // Tool 2: quest-forge-game (start game)
  // ═══════════════════════════════════════════════════════════
  .registerWidget(
    "quest-forge-game",
    {
      description: "Quest Forge — Play Visual Novel",
      _meta: { ui: { csp: SHARED_CSP } },
    },
    {
      description: TOOL2_DESCRIPTION,
      inputSchema: StartGameSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Starting your adventure...",
        "openai/toolInvocation/invoked": "Your story begins!",
      },
    },
    async (args) => {
      const input = args as unknown as z.infer<typeof StartGameSchema>;
      try {
        const game = gameStore.get(input.gameId);
        if (!game) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: gameId "${input.gameId}" not found. It may have expired (1h TTL).`,
              },
            ],
            isError: true,
          };
        }

        const initialScene = game.scenes.get("scene-1")!;
        const playerChar = game.characters.get(game.story.playerCharacter.id)! as z.infer<typeof PlayerCharacterSchema> & { portraitUrl?: string };

        // Build game data for widget
        const gameData = {
          title: game.story.title,
          genre: game.story.genre,
          synopsis: game.story.synopsis,
          style: game.story.style,
          playerCharacter: {
            id: playerChar.id,
            name: playerChar.name,
            portraitUrl: playerChar.portraitUrl,
            background: playerChar.background,
            motivation: (playerChar as any).motivation,
            innerConflict: (playerChar as any).innerConflict,
          },
          characters: Array.from(game.characters.values()).map(c => ({
            id: c.id,
            name: c.name,
            isPlayer: c.isPlayer,
            portraitUrl: c.portraitUrl,
            personality: c.personality,
          })),
          currentScene: initialScene,
          introNarration: game.story.introNarration,
        };

        // Build system prompt
        const systemPrompt = buildNarrativeSystemPrompt(
          game.story,
          initialScene,
          [],
          5
        );

        return {
          structuredContent: {
            title: game.story.title,
            genre: game.story.genre,
          },
          content: [{ type: "text" as const, text: systemPrompt }],
          _meta: { gameData },
          isError: false,
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error starting game: ${error}` }],
          isError: true,
        };
      }
    },
  )

  // ═══════════════════════════════════════════════════════════
  // Tool 3: quest-forge-generate-scene (dynamic scene generation)
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

        // Determine if this should be the ending
        const isEnding = input.sceneCount >= 9 ||
                         chosenExit.prompt.toLowerCase().includes("ending") ||
                         chosenExit.prompt.toLowerCase().includes("finale") ||
                         chosenExit.prompt.toLowerCase().includes("conclusion");

        // Generate new scene data based on the exit prompt
        // In a real implementation, this would call an LLM to generate the scene
        // For now, we'll create a structured response that the LLM can fill in

        const newSceneId = `scene-${input.sceneCount + 1}`;

        // Return a template that the LLM will use to generate the actual scene
        return {
          structuredContent: {
            gameId: input.gameId,
            previousSceneId: input.previousSceneId,
            exitChoiceId: input.exitChoiceId,
            newSceneId,
            sceneCount: input.sceneCount + 1,
            isEnding,
            generationPrompt: chosenExit.prompt,
            storyMemory: input.storyMemory,
            trustLevel: input.trustLevel,
            playerCharacter: {
              id: game.story.playerCharacter.id,
              name: game.story.playerCharacter.name,
            },
            availableNPCs: game.story.npcs.map(n => ({
              id: n.id,
              name: n.name,
              personality: n.personality,
            })),
          },
          content: [
            {
              type: "text" as const,
              text: `Generate the next scene based on the player's choice: "${chosenExit.description}"\n\n` +
                    `Story so far: ${input.sceneCount} scenes. ${isEnding ? "This should be the FINAL scene." : ""}\n\n` +
                    `Use the structured content to provide:\n` +
                    `- narration.text: Descriptive scene text\n` +
                    `- narration.mood: Atmospheric tone\n` +
                    `- setting: Location description\n` +
                    `- situation: What's happening\n` +
                    `- characters: Who is present (IDs from availableNPCs)\n` +
                    `- exits: 2-3 choices for the next scene (if not ending)`,
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
  );

export default server;
export type AppType = typeof server;
