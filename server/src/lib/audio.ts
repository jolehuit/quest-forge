/**
 * Audio generation utilities — TTS via Gradium, music via Fal Sonauto V2
 * TTS files are uploaded to Cloudflare R2 and served via public URL.
 * Music files are served directly from Fal/Sonauto CDN.
 * Both are optional: functions return null if API keys or config are missing.
 */

import crypto from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fal } from "@fal-ai/client";

// ═══════════════════════════════════════════════════════════
// R2 client (lazy init — only created if env vars are set)
// ═══════════════════════════════════════════════════════════

let r2Client: S3Client | null = null;

function getR2(): { client: S3Client; bucket: string; publicUrl: string } | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) return null;

  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  return { client: r2Client, bucket, publicUrl: publicUrl.replace(/\/$/, "") };
}

async function uploadToR2(buffer: Buffer, key: string, contentType: string): Promise<string | null> {
  const r2 = getR2();
  if (!r2) return null;

  try {
    await r2.client.send(new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    return `${r2.publicUrl}/${key}`;
  } catch (error) {
    console.error("R2 upload failed:", error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// TTS — Gradium API
// ═══════════════════════════════════════════════════════════

export async function generateTTS(
  text: string,
  voiceId: string,
): Promise<string | null> {
  const apiKey = process.env.GRADIUM_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch("https://eu.api.gradium.ai/api/post/speech/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        output_format: "opus",
        only_audio: true,
      }),
    });

    if (!response.ok) {
      console.error(`Gradium TTS error: ${response.status} ${response.statusText}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const key = `audio/tts-${crypto.randomUUID()}.opus`;
    return await uploadToR2(buffer, key, "audio/ogg; codecs=opus");
  } catch (error) {
    console.error("Failed to generate TTS:", error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// Music — Fal Sonauto V2
// ═══════════════════════════════════════════════════════════

async function generateMusic(
  tags: string[],
): Promise<string | null> {
  try {
    const result = await fal.subscribe("sonauto/v2/text-to-music", {
      input: {
        tags,
        lyrics_prompt: "", // empty = instrumental only
        output_format: "mp3",
        output_bit_rate: 128 as unknown as "128", // API expects number despite SDK types
        num_songs: 1,
        prompt_strength: 2,
        balance_strength: 0.3, // sharper instrumentals
      },
    });

    // Audio can be an array or a single object depending on num_songs
    const audio = result.data?.audio;
    const audioUrl = Array.isArray(audio) ? audio[0]?.url : (audio as { url?: string })?.url;
    if (!audioUrl) {
      console.error("Sonauto: no audio URL in response");
      return null;
    }

    return audioUrl;
  } catch (error: unknown) {
    const body = (error as { body?: unknown })?.body;
    console.error("Failed to generate music:", error, body ? JSON.stringify(body) : "");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// Voice selection
// ═══════════════════════════════════════════════════════════

const NARRATOR_VOICES: Record<string, { male: string; female: string }> = {
  fr: { male: "axlOaUiFyOZhy4nv", female: "b35yykvVppLXyw_l" }, // Leo / Elise
  en: { male: "m86j6D7UZpGzHsNu", female: "YTpq7expH9539ERJ" }, // Jack / Emma
  de: { male: "0y1VZjPabOBU3rWy", female: "-uP9MuGtBqAvEyxI" }, // Maximilian / Mia
  es: { male: "xu7iJ_fn2ElcWp2s", female: "B36pbz5_UoWn4BDl" }, // Sergio / Valentina
  pt: { male: "M-FvVo9c-jGR4PgP", female: "pYcGZz9VOo4n2ynh" }, // Davi / Alice
};

export function getNarratorVoice(
  language: string,
  gender: "male" | "female" = "male",
): string {
  return NARRATOR_VOICES[language]?.[gender] ?? NARRATOR_VOICES.fr[gender];
}

// ═══════════════════════════════════════════════════════════
// Music track generation — sequential to respect Fal concurrency
// ═══════════════════════════════════════════════════════════

// Map free-text tone descriptions to valid Sonauto tags
// (tone comes from the LLM and can be in any language)
const TONE_TO_TAGS: Record<string, string[]> = {
  dark: ["dark", "melancholic"],
  heroic: ["energetic", "uplifting"],
  mysterious: ["ethereal", "dreamy"],
  hopeful: ["uplifting", "warm"],
  tense: ["dark", "atmospheric"],
  somber: ["melancholic", "atmospheric"],
  sombre: ["melancholic", "atmospheric"],
  romantic: ["romantic", "passionate"],
  playful: ["playful", "energetic"],
  epic: ["energetic", "passionate"],
  whimsical: ["playful", "dreamy"],
  melancholic: ["melancholic", "ethereal"],
  warm: ["warm", "romantic"],
};

function toneToTags(tone: string): string[] {
  const lower = tone.toLowerCase();
  for (const [keyword, tags] of Object.entries(TONE_TO_TAGS)) {
    if (lower.includes(keyword)) return tags;
  }
  return ["atmospheric"];
}

export async function generateMusicTracks(
  genres: string[],
  tone: string,
): Promise<Map<string, string>> {
  const tracks = new Map<string, string>();
  const genre = genres[0] || "fantasy";
  const toneTags = toneToTags(tone);

  const moods = [
    {
      key: "ambient",
      tags: [...new Set([genre, ...toneTags, "ambient", "atmospheric", "instrumental"])],
    },
    {
      key: "tension",
      tags: [genre, "dark", "melancholic", "atmospheric", "instrumental"],
    },
    {
      key: "emotional",
      tags: [...new Set([genre, ...toneTags, "melodic", "uplifting", "warm", "instrumental"])],
    },
  ];

  // Sequential to avoid hitting Fal concurrency limits
  // (portraits already use parallel Fal calls)
  for (const m of moods) {
    const url = await generateMusic(m.tags);
    if (url) tracks.set(m.key, url);
  }

  return tracks;
}

// ═══════════════════════════════════════════════════════════
// Mood-to-track mapper
// ═══════════════════════════════════════════════════════════

export function getMusicTrackForMood(mood: string): string {
  const tensionMoods = [
    "tense", "dark", "ominous", "confrontational", "heated", "foreboding", "suspenseful",
  ];
  const emotionalMoods = [
    "hopeful", "warm", "bittersweet", "dramatic", "climactic", "revelatory",
  ];

  if (tensionMoods.some((m) => mood.toLowerCase().includes(m))) return "tension";
  if (emotionalMoods.some((m) => mood.toLowerCase().includes(m))) return "emotional";
  return "ambient";
}
