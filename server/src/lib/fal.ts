import { fal } from "@fal-ai/client";
import { env } from "../env.js";

export interface GamePlan {
  title: string;
  theme: string;
  style: string;
  characters: Array<{
    id: string;
    name: string;
    personality: string;
    portraitPrompt: string;
    secretInfo: string;
    roleplayStyle: string;
  }>;
  scenes: Array<{
    id: string;
    title: string;
    backgroundPrompt: string;
    dialogue: Array<{ speaker: string | null; text: string }>;
    choices: Array<{ text: string; nextSceneId: string; grantsAchievement?: string }>;
    unlockCondition: { type: "achievement"; achievementId: string } | null;
  }>;
  achievements: Array<{
    id: string;
    name: string;
    description: string;
    icon: string;
  }>;
  startSceneId: string;
}

interface CharacterWithAsset {
  id: string;
  name: string;
  personality: string;
  portrait: string;
  secretInfo: string;
  roleplayStyle: string;
}

interface SceneWithAsset {
  id: string;
  title: string;
  background: string;
  dialogue: Array<{ speaker: string | null; text: string }>;
  choices: Array<{ text: string; nextSceneId: string; grantsAchievement?: string }>;
  unlockCondition: { type: "achievement"; achievementId: string } | null;
}

export interface GameAssets {
  characters: CharacterWithAsset[];
  scenes: SceneWithAsset[];
}

/**
 * Generate character portraits and scene backgrounds using Fal AI
 */
export async function generateGameAssets(gamePlan: GamePlan): Promise<GameAssets> {
  // Generate character portraits
  const charactersWithAssets: CharacterWithAsset[] = await Promise.all(
    gamePlan.characters.map(async (char) => {
      try {
        const result = await fal.subscribe("fal-ai/flux/dev", {
          input: {
            prompt: `${char.portraitPrompt}, ${gamePlan.style}, portrait, character art`,
            image_size: "portrait_4_3",
          },
        });
        return {
          ...char,
          portrait: result.data?.images?.[0]?.url || getPlaceholderImage("portrait", char.name),
        };
      } catch (error) {
        console.error(`Failed to generate portrait for ${char.name}:`, error);
        return {
          ...char,
          portrait: getPlaceholderImage("portrait", char.name),
        };
      }
    })
  );

  // Generate scene backgrounds
  const scenesWithAssets: SceneWithAsset[] = await Promise.all(
    gamePlan.scenes.map(async (scene) => {
      try {
        const result = await fal.subscribe("fal-ai/flux/dev", {
          input: {
            prompt: `${scene.backgroundPrompt}, ${gamePlan.style}, landscape, scene background, atmospheric`,
            image_size: "landscape_16_9",
          },
        });
        return {
          ...scene,
          background: result.data?.images?.[0]?.url || getPlaceholderImage("scene", scene.title),
        };
      } catch (error) {
        console.error(`Failed to generate background for ${scene.title}:`, error);
        return {
          ...scene,
          background: getPlaceholderImage("scene", scene.title),
        };
      }
    })
  );

  return {
    characters: charactersWithAssets,
    scenes: scenesWithAssets,
  };
}

function getPlaceholderImage(type: "portrait" | "scene", name: string): string {
  // Return a data URI SVG placeholder
  const svg = type === "portrait"
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect fill="#2a2a4a" width="400" height="300"/><text fill="#888" font-family="sans-serif" font-size="20" x="50%" y="50%" text-anchor="middle">${name}</text></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect fill="#1a1a2e" width="800" height="450"/><text fill="#666" font-family="sans-serif" font-size="24" x="50%" y="50%" text-anchor="middle">${name}</text></svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
