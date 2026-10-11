// Retranscription vocale 100 % locale au navigateur (Web Speech API), sans compte ni clé API.
(function () {
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  const STORAGE_KEY = 'retranscript.sessions';
  const LANG = 'fr-FR';

  const $ = (id) => document.getElementById(id);
  const els = {
    support: $('support-message'),
    recordBtn: $('record-btn'),
    pauseBtn: $('pause-btn'),
    stopBtn: $('stop-btn'),
    status: $('status'),
    timer: $('timer'),
    live: $('live-text'),
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
    tabs: document.querySelectorAll('.tab'),
    panels: document.querySelectorAll('.tab-panel'),
  };

  // idle -> recording <-> paused -> idle (après arrêt, on affiche le résultat)
  const state = {
    status: 'idle',
    recognition: null,
    finalText: '',
    interimText: '',
    elapsedMs: 0,
    segmentStart: 0,
    timerId: null,
    wakeLock: null,
    current: null,
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

  function appendText(base, addition) {
    const add = addition.trim();
    if (!add) return base;
    return base ? `${base} ${add}` : add;
  }

  function loadSessions() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
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

  // ---------- Écran d'accueil du tableau de bord ----------

  function updateButtons() {
    const s = state.status;
    els.recordBtn.disabled = !SpeechRecognitionAPI || s === 'recording' || s === 'paused';
    els.pauseBtn.disabled = s !== 'recording' && s !== 'paused';
    els.pauseBtn.textContent = s === 'paused' ? 'Reprendre' : 'Pause';
    els.stopBtn.disabled = s !== 'recording' && s !== 'paused';
  }

  function renderLive() {
    els.live.textContent = '';
    els.live.append(document.createTextNode(state.finalText));
    if (state.interimText) {
      const interim = document.createElement('span');
      interim.className = 'interim';
      interim.textContent = (state.finalText ? ' ' : '') + state.interimText;
      els.live.append(interim);
    }
    els.live.scrollTop = els.live.scrollHeight;
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

  // ---------- Reconnaissance vocale ----------

  function createRecognition() {
    const rec = new SpeechRecognitionAPI();
    rec.lang = LANG;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          state.finalText = appendText(state.finalText, result[0].transcript);
        } else {
          interim += result[0].transcript;
        }
      }
      state.interimText = interim;
      renderLive();
    };

    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setStatus('Micro refusé : autorise le micro dans les réglages du navigateur.');
        stopAll(false);
      }
      // 'no-speech' et 'aborted' sont normaux : onend relancera la reconnaissance si besoin.
    };

    // Chrome coupe la reconnaissance après un long silence : on la relance tant qu'on enregistre.
    rec.onend = () => {
      state.recognition = null;
      if (state.pendingFinish) return finalizeSession();
      if (state.status === 'recording') startRecognition();
    };

    return rec;
  }

  function startRecognition() {
    try {
      state.recognition = createRecognition();
      state.recognition.start();
    } catch {
      // start() peut lever une exception si une session est déjà en cours : on ignore.
    }
  }

  function stopRecognition() {
    const rec = state.recognition;
    if (!rec) return;
    state.recognition = null;
    try {
      rec.stop();
    } catch {
      /* déjà arrêtée */
    }
  }

  // ---------- Verrou d'écran (évite que le téléphone s'endorme pendant l'enregistrement) ----------

  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && state.status === 'recording') {
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

  // ---------- Actions utilisateur ----------

  function startRecording() {
    if (!SpeechRecognitionAPI) return;
    state.status = 'recording';
    state.pendingFinish = false;
    state.finalText = '';
    state.interimText = '';
    state.elapsedMs = 0;
    setStatus('Enregistrement en cours…');
    startTimer();
    acquireWakeLock();
    startRecognition();
    updateButtons();
    renderLive();
  }

  function togglePause() {
    if (state.status === 'recording') {
      // Pause : on coupe la reconnaissance, rien n'est capté tant que c'est en pause.
      state.status = 'paused';
      stopTimer();
      stopRecognition();
      state.interimText = '';
      renderLive();
      releaseWakeLock();
      setStatus('En pause : rien n\'est capté. Appuie sur Reprendre ou Arrêt.');
    } else if (state.status === 'paused') {
      state.status = 'recording';
      setStatus('Enregistrement en cours…');
      startTimer();
      acquireWakeLock();
      startRecognition();
    }
    updateButtons();
  }

  // Arrête tout. finalize=true : sauvegarde la session et affiche le résultat.
  function stopAll(finalize) {
    const wasActive = state.status === 'recording' || state.status === 'paused';
    const hadRecognition = state.recognition !== null;
    stopTimer();
    stopRecognition();
    releaseWakeLock();
    state.status = 'idle';
    state.interimText = '';
    updateButtons();

    if (!finalize || !wasActive) return;
    state.pendingFinish = true;
    if (hadRecognition) {
      // Chrome envoie encore les derniers résultats après stop() : onend termine, délai de secours sinon.
      setTimeout(finalizeSession, 1500);
    } else {
      finalizeSession();
    }
  }

  // Idempotent : ne fait rien si la session a déjà été finalisée.
  function finalizeSession() {
    if (!state.pendingFinish) return;
    state.pendingFinish = false;
    renderLive();

    const text = state.finalText.trim();
    const session = {
      id: String(Date.now()),
      date: new Date().toISOString(),
      durationMs: Math.round(state.elapsedMs),
      text,
    };
    if (text) {
      const sessions = loadSessions();
      sessions.unshift(session);
      if (!saveSessions(sessions)) {
        setStatus('Affiché à l\'écran, mais le stockage du téléphone est plein.');
      }
    }
    renderHistory();
    showResult(session);
  }

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
    state.finalText = '';
    state.elapsedMs = 0;
    els.timer.textContent = '00:00';
    setStatus('Prêt à enregistrer.');
    renderLive();
    renderHistory();
    updateButtons();
  }

  function selectTab(name) {
    for (const tab of els.tabs) {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(active));
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

  // ---------- Branchement des événements ----------

  els.recordBtn.addEventListener('click', startRecording);
  els.pauseBtn.addEventListener('click', togglePause);
  els.stopBtn.addEventListener('click', () => stopAll(true));

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

  for (const tab of els.tabs) {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  }

  // ---------- Démarrage ----------

  if (!SpeechRecognitionAPI) {
    els.support.hidden = false;
    els.support.textContent =
      'La reconnaissance vocale n\'est pas disponible dans ce navigateur. Utilise Chrome sur Android, ou Safari récent.';
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  showRecorder();
})();
