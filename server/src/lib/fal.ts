import { fal } from "@fal-ai/client";

/**
 * Generate a character portrait using Fal AI
 */
export async function generateCharacterPortrait(
  appearance: string,
  style: string
): Promise<string> {
  try {
    const result = await fal.subscribe("fal-ai/flux/dev", {
      input: {
        prompt: `${appearance}, ${style}, portrait, character art, high quality, detailed`,
        image_size: "portrait_4_3",
        num_inference_steps: 28,
      },
    });
    return result.data?.images?.[0]?.url || getPlaceholderImage("portrait", "Character");
  } catch (error) {
    console.error("Failed to generate character portrait:", error);
    return getPlaceholderImage("portrait", "Character");
  }
}

/**
 * Check if a URL points to a valid and accessible image
 */
async function isImageUrlValid(imageUrl: string): Promise<boolean> {
  try {
    const response = await fetch(imageUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type");
    return contentType ? contentType.startsWith("image/") : false;
  } catch {
    return false;
  }
}

/**
 * Transform a reference image into a character portrait using Fal AI (img2img)
 * Falls back to txt2img if the reference URL is invalid or inaccessible
 */
export async function transformCharacterPortrait(
  imageUrl: string,
  appearance: string,
  style: string,
): Promise<string> {
  // First, validate that the URL is actually accessible
  const isValid = await isImageUrlValid(imageUrl);
  if (!isValid) {
    console.warn(`Reference image URL invalid or inaccessible: ${imageUrl}. Falling back to txt2img.`);
    return generateCharacterPortrait(appearance, style);
  }

  try {
    const result = await fal.subscribe("fal-ai/flux-2/edit", {
      input: {
        prompt: `${appearance}, ${style}, portrait, character art, high quality, detailed`,
        image_urls: [imageUrl],
        image_size: "portrait_4_3",
        num_inference_steps: 28,
        output_format: "png",
      },
    });
    return result.data?.images?.[0]?.url || getPlaceholderImage("portrait", "Character");
  } catch (error) {
    console.error("Failed to transform character portrait:", error);
    return getPlaceholderImage("portrait", "Character");
  }
}

/**
 * Generate a scene background using Fal AI
 */
export async function generateSceneBackground(
  setting: string,
  style: string
): Promise<string> {
  try {
    const result = await fal.subscribe("fal-ai/flux/dev", {
      input: {
        prompt: `${setting}, ${style}, landscape, scene background, atmospheric, cinematic lighting`,
        image_size: "landscape_16_9",
        num_inference_steps: 28,
      },
    });
    return result.data?.images?.[0]?.url || getPlaceholderImage("scene", "Scene");
  } catch (error) {
    console.error("Failed to generate scene background:", error);
    return getPlaceholderImage("scene", "Scene");
  }
}

function getPlaceholderImage(type: "portrait" | "scene", name: string): string {
  // Return a data URI SVG placeholder
  const svg = type === "portrait"
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect fill="#2a2a4a" width="400" height="300"/><text fill="#888" font-family="sans-serif" font-size="20" x="50%" y="50%" text-anchor="middle">${name}</text></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect fill="#1a1a2e" width="800" height="450"/><text fill="#666" font-family="sans-serif" font-size="24" x="50%" y="50%" text-anchor="middle">${name}</text></svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
