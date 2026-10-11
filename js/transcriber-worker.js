// Moteur de transcription Whisper, exécuté dans un worker pour ne pas figer l'interface.
// Le modèle est téléchargé une seule fois, puis gardé dans le cache du navigateur.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

// base en précision complète (fp32) : le format quantifié q8 de small a échoué à la création de session
// (« TransposeDQWeightsForMatMulNBits Missing required scale ») sur le moteur WebAssembly du navigateur.
const MODEL_ID = 'Xenova/whisper-base';
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
