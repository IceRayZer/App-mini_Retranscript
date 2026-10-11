// Analyse locale et gratuite : détection de tâches et résumé par règles.
// Fonctions pures, sans dépendance, utilisables dans le navigateur et dans les tests Node.

(function (root) {
  const TASK_PATTERNS = [
    /\bil faut\b/,
    /\bfaut que\b/,
    /\bje dois\b/,
    /\btu dois\b/,
    /\bvous devez\b/,
    /\bnous devons\b/,
    /\bil faudra\b/,
    /\bpenser a\b/,
    /\bn'oubli(e|ez|ons)? pas\b/,
    /\brappelle[- ]?moi\b/,
    /\brappeler\b/,
    /\bprendre rendez[- ]vous\b/,
    /\bacheter\b/,
    /\bappeler\b/,
    /\benvoyer\b/,
    /\breserver\b/,
    /\bpreparer\b/,
    /\bfinir\b/,
    /\bnoter\b/,
    /\ba faire\b/,
  ];

  const STOPWORDS = new Set([
    'alors', 'aussi', 'avec', 'avoir', 'beaucoup', 'bien', 'comme', 'dans', 'donc',
    'elle', 'elles', 'etre', 'faire', 'mais', 'meme', 'nous', 'pour',
    'quand', 'quel', 'quelle', 'quels', 'quelles', 'qui', 'sans', 'sont', 'tout',
    'toute', 'tous', 'tres', 'vous', 'cette', 'ces', 'dont', 'leur',
    'leurs', 'plus', 'pas', 'fait', 'aller', 'peut', 'peuvent', 'entre',
  ]);

  function normalize(text) {
    return text
      .toLowerCase()
      .replace(/’/g, "'")
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  function splitSentences(text) {
    return text
      .split(/(?<=[.!?…])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // Renvoie les phrases qui ressemblent à une tâche à faire, sans doublon.
  function extractTasks(text) {
    const seen = new Set();
    const tasks = [];
    for (const sentence of splitSentences(text)) {
      const normalized = normalize(sentence);
      if (!TASK_PATTERNS.some((re) => re.test(normalized))) continue;
      const key = normalized.replace(/[^a-z0-9]/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push(sentence);
    }
    return tasks;
  }

  // Résumé extractif : garde les phrases les plus riches en mots fréquents, dans l'ordre d'origine.
  function summarize(text, maxSentences = 3) {
    const sentences = splitSentences(text);
    if (sentences.length <= maxSentences) return sentences;

    const words = (s) =>
      normalize(s)
        .match(/[a-z0-9]+/g)
        ?.filter((w) => w.length > 3 && !STOPWORDS.has(w)) ?? [];

    const freq = new Map();
    for (const s of sentences) {
      for (const w of words(s)) freq.set(w, (freq.get(w) || 0) + 1);
    }

    const scored = sentences.map((s, index) => {
      const ws = words(s);
      const score = ws.length
        ? ws.reduce((sum, w) => sum + freq.get(w), 0) / Math.sqrt(ws.length)
        : 0;
      return { index, s, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSentences)
      .sort((a, b) => a.index - b.index)
      .map((x) => x.s);
  }

  const api = { splitSentences, extractTasks, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Analysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
