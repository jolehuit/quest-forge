import { McpServer } from "skybridge/server";
import { z } from "zod";
import { generateGameAssets, type GamePlan } from "./lib/fal.js";

// --- Schemas ---

const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  personality: z.string().describe("Brief personality traits visible to the player"),
  portraitPrompt: z.string().describe("Image generation prompt for the character portrait"),
  // LLM-only knowledge (goes in content, hidden from widget/player)
  secretInfo: z
    .string()
    .describe(
      "Secret knowledge about this character that ONLY the LLM knows. The player must discover this through dialogue. E.g. hidden motivations, lies they tell, what they're hiding.",
    ),
  roleplayStyle: z
    .string()
    .describe(
      "How the LLM should roleplay this character: speech patterns, mannerisms, emotional state, what they reveal under pressure. E.g. 'Speaks in short nervous sentences. Will accidentally mention the artifact if asked about Tuesday.'",
    ),
});

const DialogueLineSchema = z.object({
  speaker: z.string().nullable().describe("Character name, or null for narrator"),
  text: z.string(),
});

const ChoiceSchema = z.object({
  text: z.string().describe("The choice text shown to the player"),
  nextSceneId: z.string(),
  grantsAchievement: z.string().optional().describe("Achievement ID to grant when this choice is picked"),
});

const SceneSchema = z.object({
  id: z.string(),
  title: z.string(),
  backgroundPrompt: z.string().describe("Image generation prompt for the scene background"),
  dialogue: z.array(DialogueLineSchema).min(1),
  choices: z.array(ChoiceSchema).describe("Empty array means this is an ending scene"),
  unlockCondition: z
    .object({
      type: z.literal("achievement"),
      achievementId: z.string(),
    })
    .nullable()
    .describe("If set, scene is only accessible when the player has this achievement. Null means always accessible."),
});

const AchievementSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().describe("An emoji to represent this achievement"),
});

const server = new McpServer(
  {
    name: "quest-forge",
    version: "0.0.1",
  },
  { capabilities: {} },
).registerWidget(
  "quest-forge",
  {
    description: "Quest Forge - AI Visual Novel Generator",
    _meta: {
      ui: {
        csp: {
          resourceDomains: ["https://fal.media", "https://*.fal.media"],
        },
      },
    },
  },
  {
    description:
      "Generate and play a visual novel game. Plan the story with characters, scenes, dialogue, choices, and achievements. The AI will generate artwork and you become the narrator.",
    inputSchema: {
      title: z.string().describe("The title of the visual novel"),
      theme: z.string().describe("The theme/genre (e.g. fantasy, sci-fi, horror, romance)"),
      style: z.string().describe("Art style for generated images (e.g. anime, watercolor, pixel art, dark fantasy)"),
      characters: z.array(CharacterSchema).min(1).describe("The characters in the story"),
      scenes: z
        .array(SceneSchema)
        .min(2)
        .describe("The scenes of the visual novel. Must have at least one ending scene (empty choices)."),
      achievements: z.array(AchievementSchema).describe("Achievements the player can unlock"),
      startSceneId: z.string().describe("The ID of the first scene"),
      // LLM-only narrative secrets
      storySecrets: z
        .string()
        .describe(
          "Hidden plot secrets that ONLY the LLM knows. The player discovers these through gameplay. The LLM can drop subtle hints but must NEVER reveal directly. E.g. 'The kingdom fell because the king poisoned himself. The advisor knows but is blackmailed into silence.'",
        ),
      // Intro narrative for the widget
      introDialogue: z
        .array(z.string())
        .min(1)
        .describe(
          "Narrator lines shown during the intro screen before gameplay starts. Sets the atmosphere and hook. Each string is one typewriter-revealed line. E.g. ['The kingdom of Eldara has known peace for a thousand years.', 'Until tonight.', 'You are the last person to see the king alive.']",
        ),
    },
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
  async ({ title, theme, style, characters, scenes, achievements, startSceneId, storySecrets, introDialogue }) => {
    try {
      const gamePlan: GamePlan = { title, theme, style, characters, scenes, achievements, startSceneId };

      // Generate all assets via Fal AI
      const assets = await generateGameAssets(gamePlan);

      // ── Build system prompt (LLM-only knowledge) ──
      // This is the ASYMMETRIC part: the LLM knows secrets the player doesn't

      const characterBlocks = characters
        .map(
          (c: {
            name: string;
            personality: string;
            secretInfo: string;
            roleplayStyle: string;
          }) => `### ${c.name}
Public personality: ${c.personality}
SECRET (never reveal directly, only hint): ${c.secretInfo}
How to roleplay: ${c.roleplayStyle}`,
        )
        .join("\n\n");

      const systemPrompt = `You are the narrator and game master of the visual novel "${title}" (theme: ${theme}).

═══════════════════════════════════════
STORY SECRETS — ONLY YOU KNOW THESE
The player must discover them through gameplay.
You may drop subtle hints but NEVER reveal directly.
═══════════════════════════════════════
${storySecrets}

═══════════════════════════════════════
CHARACTER DOSSIERS
═══════════════════════════════════════
${characterBlocks}

═══════════════════════════════════════
YOUR RULES
═══════════════════════════════════════
- You ARE the narrator. Narrate scene transitions immersively and dramatically.
- When a character speaks in a scene, BECOME that character. Use their roleplay style.
- Characters may slip up and reveal hints when pressured — but only subtly.
- Keep responses SHORT (2-3 sentences). The widget handles the main dialogue display.
- NEVER spoil upcoming scenes, hidden paths, or locked content.
- NEVER call the quest-forge tool again.
- When the player makes a choice, describe the consequence dramatically.
- When the player reaches an ending, give a powerful closing narration.
- If the player talks to you between scenes, stay in the world — improvise as narrator or as the last character who spoke.

The visual novel widget is now displayed. Start by welcoming the player to "${title}" with a brief, atmospheric hook.`;

      return {
        structuredContent: { title, theme },
        content: [{ type: "text" as const, text: systemPrompt }],
        _meta: {
          gameData: {
            title,
            theme,
            style,
            characters: assets.characters,
            scenes: assets.scenes,
            achievements,
            startSceneId,
            introDialogue,
          },
        },
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

export default server;
export type AppType = typeof server;
