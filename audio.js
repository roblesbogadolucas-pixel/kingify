/**
 * Kingify v2 — Audio transcription (Whisper)
 */
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TMP_PATH = path.join(__dirname, '.tmp_audio.ogg');

async function transcribe(buffer) {
  fs.writeFileSync(TMP_PATH, buffer);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(TMP_PATH),
      model: 'whisper-1',
      language: 'es',
      response_format: 'text',
    });
    return transcription;
  } finally {
    if (fs.existsSync(TMP_PATH)) fs.unlinkSync(TMP_PATH);
  }
}

module.exports = { transcribe };
