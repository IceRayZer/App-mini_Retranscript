// Moteur de transcription Whisper, exécuté dans un worker pour ne pas figer l'interface.
// Le modèle est téléchargé une seule fois, puis gardé dans le cache du navigateur.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

// small en précision complète (fp32) : meilleure compréhension du français que base.
// Le format quantifié q8 a échoué à la création de session sur le moteur WebAssembly
// (« TransposeDQWeightsForMatMulNBits Missing required scale »), donc on reste en fp32.
const MODEL_ID = 'Xenova/whisper-small';
const DTYPE = { encoder_model: 'fp32', decoder_model_merged: 'fp32' };

env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriberPromise = null;

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: DTYPE,
      device: 'wasm',
      progress_callback: (p) => {
        if (p.status === 'progress') {
          self.postMessage({ type: 'progress', file: p.file, progress: p.progress });
        }
      },
    }).catch((err) => {
      transcriberPromise = null; // permet de réessayer au prochain essai
      throw err;
    });
  }
  return transcriberPromise;
}

self.onmessage = async (event) => {
  const { type, audio } = event.data;
  try {
    if (type === 'load') {
      await getTranscriber();
      self.postMessage({ type: 'ready' });
    } else if (type === 'transcribe') {
      const transcriber = await getTranscriber();
      const output = await transcriber(audio, {
        language: 'french',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      self.postMessage({ type: 'result', text: (output.text || '').trim() });
    }
  } catch (err) {
    self.postMessage({ type: 'error', phase: type, message: err?.message || String(err) });
  }
};
