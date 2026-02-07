import { fal } from "@fal-ai/client";
import { env } from "../env.js";

// Input type from server.ts (partial GamePlan)
export interface GamePlan {
  style: string;
  persona: {
    portraitPrompt: string;
  };
  scenes: Array<{
    id: string;
    backgroundPrompt: string;
  }>;
}

interface SceneWithAsset {
  id: string;
  backgroundUrl: string;
}

export interface GameAssets {
  portraitUrl: string;
  scenes: SceneWithAsset[];
}

/**
 * Generate character portrait and scene backgrounds using Fal AI
 */
export async function generateGameAssets(gamePlan: GamePlan): Promise<GameAssets> {
  // Generate character portrait
  let portraitUrl: string;
  try {
    const result = await fal.subscribe("fal-ai/flux/dev", {
      input: {
        prompt: `${gamePlan.persona.portraitPrompt}, ${gamePlan.style}, portrait, character art`,
        image_size: "portrait_4_3",
      },
    });
    portraitUrl = result.data?.images?.[0]?.url || getPlaceholderImage("portrait", "Character");
  } catch (error) {
    console.error("Failed to generate portrait:", error);
    portraitUrl = getPlaceholderImage("portrait", "Character");
  }

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
          id: scene.id,
          backgroundUrl: result.data?.images?.[0]?.url || getPlaceholderImage("scene", scene.id),
        };
      } catch (error) {
        console.error(`Failed to generate background for ${scene.id}:`, error);
        return {
          id: scene.id,
          backgroundUrl: getPlaceholderImage("scene", scene.id),
        };
      }
    })
  );

  return {
    portraitUrl,
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
