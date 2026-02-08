/**
 * Audio generation utilities — TTS via Gradium, music via ElevenLabs
 * Both are optional: functions return null if API keys are missing or on error.
 * Audio is stored in memory and served via Express endpoint /audio/:id
 */

import crypto from "node:crypto";

// ═══════════════════════════════════════════════════════════
// Audio store — serves audio via /audio/:id endpoint
// ═══════════════════════════════════════════════════════════

interface StoredAudio {
  buffer: Buffer;
  contentType: string;
  createdAt: number;
}

const audioStore = new Map<string, StoredAudio>();

// Cleanup TTL (1h)
setInterval(() => {
  const now = Date.now();
  for (const [id, audio] of audioStore) {
    if (now - audio.createdAt > 3600000) audioStore.delete(id);
  }
}, 600000);

export function getAudioBuffer(id: string): StoredAudio | undefined {
  return audioStore.get(id);
}

function storeAudio(buffer: Buffer, contentType: string, ext: string): string {
  const id = crypto.randomUUID();
  audioStore.set(id, { buffer, contentType, createdAt: Date.now() });
  return `/audio/${id}.${ext}`;
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
    return storeAudio(buffer, "audio/ogg; codecs=opus", "opus");
  } catch (error) {
    console.error("Failed to generate TTS:", error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// Music — ElevenLabs API
// ═══════════════════════════════════════════════════════════

export async function generateMusic(
  prompt: string,
  durationMs: number = 15000,
): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      "https://api.elevenlabs.io/v1/music?output_format=mp3_22050_32",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          prompt,
          music_length_ms: durationMs,
          model_id: "music_v1",
          force_instrumental: true,
        }),
      },
    );

    if (!response.ok) {
      console.error(`ElevenLabs music error: ${response.status} ${response.statusText}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return storeAudio(buffer, "audio/mpeg", "mp3");
  } catch (error) {
    console.error("Failed to generate music:", error);
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
// Music track generation
// ═══════════════════════════════════════════════════════════

export async function generateMusicTracks(
  genres: string[],
  tone: string,
): Promise<Map<string, string>> {
  const tracks = new Map<string, string>();

  const moods = [
    {
      key: "ambient",
      prompt: `${tone} ${genres[0] || "fantasy"} instrumental background. Atmospheric, immersive, calm. No vocals. Loop-friendly.`,
    },
    {
      key: "tension",
      prompt: `Dark ${genres[0] || "fantasy"} instrumental. Tense, ominous, suspenseful. No vocals. Loop-friendly.`,
    },
    {
      key: "emotional",
      prompt: `${tone} ${genres[0] || "fantasy"} instrumental. Hopeful, warm, emotional. No vocals. Loop-friendly.`,
    },
  ];

  const results = await Promise.all(
    moods.map((m) => generateMusic(m.prompt, 15000)),
  );

  moods.forEach((m, i) => {
    if (results[i]) tracks.set(m.key, results[i]!);
  });

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
