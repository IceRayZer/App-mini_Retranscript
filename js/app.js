// Enregistrement audio local, puis retranscription Whisper dans le navigateur (aucun envoi, aucun compte).
(function () {
  const STORAGE_KEY = 'retranscript.sessions';
  const GLOSSARY_KEY = 'retranscript.glossary';
  const MIN_DURATION_MS = 1000;

  const $ = (id) => document.getElementById(id);
  const els = {
    support: $('support-message'),
    recordBtn: $('record-btn'),
    pauseBtn: $('pause-btn'),
    stopBtn: $('stop-btn'),
    status: $('status'),
    timer: $('timer'),
    hint: $('live-text'),
    progress: $('progress'),
    progressLabel: $('progress-label'),
    progressFill: $('progress-fill'),
    recorder: $('recorder'),
    result: $('result'),
    resultText: $('result-text'),
    tasksList: $('tasks-list'),
    summaryList: $('summary-list'),
    history: $('history'),
    historyList: $('history-list'),
    copyBtn: $('copy-btn'),
    exportBtn: $('export-btn'),
    newBtn: $('new-btn'),
    deleteBtn: $('delete-btn'),
    glossaryInput: $('glossary-input'),
    tabs: document.querySelectorAll('.tab'),
    panels: document.querySelectorAll('.tab-panel'),
  };

  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

  // idle -> recording <-> paused -> transcribing -> idle
  const state = {
    status: 'idle',
    recorder: null,
    stream: null,
    chunks: [],
    elapsedMs: 0,
    segmentStart: 0,
    timerId: null,
    wakeLock: null,
    current: null,
    modelReady: false,
    modelRequested: false,
  };

  // ---------- Utilitaires ----------

  function setStatus(text) {
    els.status.textContent = text;
  }

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  }

  function loadSessions() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function loadGlossary() {
    try {
      return JSON.parse(localStorage.getItem(GLOSSARY_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveGlossary(terms) {
    try {
      localStorage.setItem(GLOSSARY_KEY, JSON.stringify(terms));
    } catch {
      /* stockage plein : le glossaire reste utilisable pour cette session */
    }
  }

  function saveSessions(sessions) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
      return true;
    } catch {
      return false;
    }
  }

  // ---------- Affichage ----------

  // percent connu : barre remplie ; null : barre qui glisse (durée inconnue).
  function showProgress(label, percent = null) {
    els.progress.hidden = false;
    els.progressLabel.textContent = label;
    els.progressFill.classList.toggle('indeterminate', percent === null);
    els.progressFill.style.width = percent === null ? '' : `${Math.min(100, Math.max(0, percent))}%`;
  }

  function hideProgress() {
    els.progress.hidden = true;
  }

  function updateButtons() {
    const s = state.status;
    const busy = s === 'transcribing';
    els.recordBtn.disabled = !canRecord || busy || s === 'recording' || s === 'paused';
    els.pauseBtn.disabled = !(s === 'recording' || s === 'paused');
    els.pauseBtn.textContent = s === 'paused' ? 'Reprendre' : 'Pause';
    els.stopBtn.disabled = !(s === 'recording' || s === 'paused');
  }

  function renderHistory() {
    const sessions = loadSessions();
    els.historyList.textContent = '';
    els.history.hidden = sessions.length === 0;
    for (const session of sessions) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-item';
      const date = new Date(session.date).toLocaleString('fr-FR', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
      btn.textContent = `${date} · ${formatTime(session.durationMs)}`;
      btn.addEventListener('click', () => showResult(session));
      li.append(btn);
      els.historyList.append(li);
    }
  }

  // ---------- Moteur de transcription (worker Whisper) ----------

  const worker = new Worker('js/transcriber-worker.js', { type: 'module' });

  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'progress') {
      if (!state.modelReady) {
        const pct = Math.round(msg.progress || 0);
        showProgress(`Téléchargement du modèle (une seule fois) : ${pct} %`, pct);
      }
    } else if (msg.type === 'ready') {
      state.modelReady = true;
      hideProgress();
      if (state.status === 'idle') setStatus('Prêt à enregistrer.');
    } else if (msg.type === 'result') {
      finishSession(msg.text);
    } else if (msg.type === 'error') {
      if (msg.phase === 'load') {
        // Un échec de préchargement ne doit pas couper un enregistrement en cours : on pourra réessayer.
        state.modelRequested = false;
        hideProgress();
        if (state.status === 'idle') setStatus(`Modèle indisponible : ${msg.message}`);
      } else {
        failTranscription(msg.message);
      }
    }
  };

  const WORKER_ERROR = 'moteur de transcription indisponible. Vérifie la connexion (premier lancement) puis recharge la page.';
  let workerFailed = false;

  worker.onerror = () => {
    workerFailed = true;
    if (state.status === 'transcribing') failTranscription(WORKER_ERROR);
    else if (state.status === 'idle') setStatus(`Erreur : ${WORKER_ERROR}`);
  };

  // Télécharge le modèle en arrière-plan dès le premier enregistrement, pour éviter l'attente à l'arrêt.
  function preloadModel() {
    if (state.modelRequested) return;
    state.modelRequested = true;
    worker.postMessage({ type: 'load' });
  }

  // ---------- Enregistrement audio ----------

  function pickMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  }

  function releaseStream() {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  async function startRecording() {
    if (!canRecord || state.status !== 'idle') return;
    if (workerFailed) {
      setStatus(`Erreur : ${WORKER_ERROR}`);
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setStatus('Micro refusé : autorise le micro dans les réglages du navigateur.');
      return;
    }

    const mimeType = pickMimeType();
    state.recorder = mimeType
      ? new MediaRecorder(state.stream, { mimeType })
      : new MediaRecorder(state.stream);
    state.chunks = [];
    state.elapsedMs = 0;
    state.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    };
    state.recorder.start(1000);

    state.status = 'recording';
    startTimer();
    acquireWakeLock();
    preloadModel();
    setStatus('Enregistrement en cours…');
    updateButtons();
  }

  function togglePause() {
    if (!state.recorder) return;
    if (state.status === 'recording') {
      // Pause : le navigateur n'enregistre plus rien tant que c'est en pause.
      state.recorder.pause();
      stopTimer(); // doit être appelé avant de changer le statut, pour compter le temps écoulé
      state.status = 'paused';
      releaseWakeLock();
      setStatus('En pause : rien n\'est enregistré. Reprendre ou Arrêt.');
    } else if (state.status === 'paused') {
      state.recorder.resume();
      state.status = 'recording';
      startTimer();
      acquireWakeLock();
      setStatus('Enregistrement en cours…');
    }
    updateButtons();
  }

  // Décode l'audio enregistré en Float32 mono 16 kHz, format attendu par Whisper.
  async function decodeTo16kMono(arrayBuffer) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(arrayBuffer);
    } finally {
      ctx.close();
    }
    if (decoded.sampleRate === 16000 && decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0).slice();
    }
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  }

  function stopRecording() {
    if (!state.recorder || (state.status !== 'recording' && state.status !== 'paused')) return;
    stopTimer();
    state.status = 'transcribing';
    updateButtons();
    setStatus('Préparation de l\'audio…');

    const recorder = state.recorder;
    recorder.onstop = async () => {
      releaseStream();
      const durationMs = Math.round(state.elapsedMs);
      if (durationMs < MIN_DURATION_MS || state.chunks.length === 0) {
        state.status = 'idle';
        state.recorder = null;
        updateButtons();
        setStatus('Enregistrement trop court, rien à transcrire.');
        return;
      }
      if (workerFailed) {
        failTranscription(WORKER_ERROR);
        return;
      }
      try {
        const blob = new Blob(state.chunks, { type: recorder.mimeType || 'audio/webm' });
        const samples = await decodeTo16kMono(await blob.arrayBuffer());
        state.current = { durationMs };
        startTranscriptionProgress();
        worker.postMessage({ type: 'transcribe', audio: samples }, [samples.buffer]);
      } catch {
        failTranscription('impossible de lire l\'enregistrement audio.');
      } finally {
        state.chunks = [];
        state.recorder = null;
      }
    };
    recorder.stop();
  }

  // Pendant la transcription : barre qui glisse et temps écoulé, pour montrer que ça tourne.
  let transcribeStart = 0;
  let transcribeTimerId = null;

  function startTranscriptionProgress() {
    transcribeStart = performance.now();
    acquireWakeLock(); // l'écran ne doit pas s'éteindre pendant le calcul
    const update = () => {
      const label = state.modelReady
        ? 'Transcription en cours…'
        : 'Chargement du modèle puis transcription…';
      showProgress(`${label} ${formatTime(performance.now() - transcribeStart)} écoulées`);
      setStatus('Ne ferme pas l\'écran. Un long enregistrement peut prendre plusieurs minutes.');
    };
    update();
    clearInterval(transcribeTimerId);
    transcribeTimerId = setInterval(update, 1000);
  }

  function stopTranscriptionProgress() {
    clearInterval(transcribeTimerId);
    transcribeTimerId = null;
    releaseWakeLock();
    hideProgress();
  }

  function failTranscription(message) {
    stopTranscriptionProgress();
    state.status = 'idle';
    state.recorder = null;
    state.chunks = [];
    updateButtons();
    setStatus(`Erreur : ${message}`);
  }

  function finishSession(text) {
    stopTranscriptionProgress();
    const durationMs = state.current?.durationMs ?? Math.round(state.elapsedMs);
    state.current = null;
    state.status = 'idle';
    updateButtons();

    const session = {
      id: String(Date.now()),
      date: new Date().toISOString(),
      durationMs,
      text: window.Analysis.applyGlossary(text, loadGlossary()).trim(),
    };
    if (session.text) {
      const sessions = loadSessions();
      sessions.unshift(session);
      if (!saveSessions(sessions)) {
        setStatus('Affiché à l\'écran, mais le stockage du téléphone est plein.');
      }
    }
    renderHistory();
    showResult(session);
  }

  // ---------- Chronomètre (ne compte que le temps d'enregistrement actif) ----------

  function startTimer() {
    state.segmentStart = performance.now();
    clearInterval(state.timerId);
    state.timerId = setInterval(() => {
      els.timer.textContent = formatTime(currentElapsed());
    }, 250);
  }

  function stopTimer() {
    clearInterval(state.timerId);
    state.timerId = null;
    state.elapsedMs = currentElapsed();
    els.timer.textContent = formatTime(state.elapsedMs);
  }

  function currentElapsed() {
    const running = state.status === 'recording' ? performance.now() - state.segmentStart : 0;
    return state.elapsedMs + running;
  }

  // ---------- Verrou d'écran ----------

  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && (state.status === 'recording' || state.status === 'transcribing')) {
        state.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      /* non supporté ou refusé : pas bloquant */
    }
  }

  function releaseWakeLock() {
    try {
      state.wakeLock?.release();
    } catch {
      /* ignore */
    }
    state.wakeLock = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.status === 'recording') {
      acquireWakeLock();
    }
  });

  // ---------- Écran de résultat ----------

  function fillList(listEl, items, emptyText) {
    listEl.textContent = '';
    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = emptyText;
      listEl.append(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item;
      listEl.append(li);
    }
  }

  function showResult(session) {
    state.current = session;
    els.recorder.hidden = true;
    els.result.hidden = false;
    els.resultText.textContent = session.text || 'Aucun texte détecté.';
    fillList(els.tasksList, window.Analysis.extractTasks(session.text), 'Aucune tâche détectée.');
    fillList(els.summaryList, window.Analysis.summarize(session.text, 3), 'Rien à résumer.');
    selectTab('transcript');
    window.scrollTo(0, 0);
  }

  function showRecorder() {
    state.current = null;
    els.result.hidden = true;
    els.recorder.hidden = false;
    state.elapsedMs = 0;
    els.timer.textContent = '00:00';
    els.hint.textContent = 'Appuie sur Enregistrer et parle. La transcription se fait à l\'arrêt, sur ton téléphone.';
    setStatus(state.modelReady ? 'Prêt à enregistrer.' : 'Prêt à enregistrer. Le modèle se chargera au premier enregistrement.');
    renderHistory();
    updateButtons();
  }

  function selectTab(name) {
    for (const tab of els.tabs) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    }
    for (const panel of els.panels) {
      panel.hidden = panel.dataset.panel !== name;
    }
  }

  function exportText(session) {
    const date = new Date(session.date).toLocaleString('fr-FR');
    const body = `Retranscription du ${date}\n\n${session.text}\n`;
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retranscription-${session.id}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Événements ----------

  els.recordBtn.addEventListener('click', startRecording);
  els.pauseBtn.addEventListener('click', togglePause);
  els.stopBtn.addEventListener('click', stopRecording);

  els.copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.current?.text || '');
      els.copyBtn.textContent = 'Copié ✓';
      setTimeout(() => (els.copyBtn.textContent = 'Copier'), 1500);
    } catch {
      els.copyBtn.textContent = 'Copie impossible';
    }
  });

  els.exportBtn.addEventListener('click', () => state.current && exportText(state.current));

  els.deleteBtn.addEventListener('click', () => {
    if (!state.current) return;
    if (!window.confirm('Supprimer cette retranscription ?')) return;
    saveSessions(loadSessions().filter((s) => s.id !== state.current.id));
    showRecorder();
  });

  els.newBtn.addEventListener('click', showRecorder);

  els.glossaryInput.value = loadGlossary().join('\n');
  els.glossaryInput.addEventListener('change', () => {
    const terms = els.glossaryInput.value.split('\n').map((t) => t.trim()).filter(Boolean);
    saveGlossary(terms);
  });

  for (const tab of els.tabs) {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  }

  // ---------- Démarrage ----------

  if (!canRecord) {
    els.support.hidden = false;
    els.support.textContent = 'Enregistrement audio non disponible dans ce navigateur. Utilise Chrome ou Safari récent.';
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  showRecorder();
})();
