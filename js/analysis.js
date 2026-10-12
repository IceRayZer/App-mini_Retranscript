// Analyse locale et gratuite : découpage en points, détection de tâches, résumé et correction par glossaire.
// Fonctions pures, sans dépendance, utilisables dans le navigateur et dans les tests Node.

(function (root) {
  // Verbes d'action courants, à l'infinitif. Les formes « -ez » (impératif) sont déduites automatiquement.
  const ACTION_VERBS = new Set([
    'faire', 'finir', 'continuer', 'prendre', 'chercher', 'appeler', 'renseigner', 'reviser',
    'acheter', 'envoyer', 'payer', 'rappeler', 'reserver', 'preparer', 'poser', 'voir',
    'aller', 'contacter', 'ecrire', 'lire', 'organiser', 'verifier', 'commander', 'remplir',
    'signer', 'deposer', 'rendre', 'telephoner', 'mettre', 'passer', 'demander', 'terminer',
    'commencer', 'debuter', 'valider', 'imprimer', 'trouver', 'inscrire', 'ranger', 'nettoyer',
    'donner', 'recuperer', 'regler', 'planifier', 'relire', 'corriger', 'proposer', 'comparer',
    'tester', 'essayer', 'choisir', 'obtenir', 'creer', 'modifier', 'annuler', 'confirmer',
  ]);

  const TASK_PATTERNS = [
    /\bil faut\b/,
    /\bfaut que\b/,
    /\bje dois\b/,
    /\btu dois\b/,
    /\bvous devez\b/,
    /\bnous devons\b/,
    /\bil faudra\b/,
    /\bon doit\b/,
    /\bpenser a\b/,
    /\bn'oubli(e|ez|ons)? pas\b/,
    /\brappelle[- ]?moi\b/,
    /\bil reste a\b/,
    /\bdemain\b/,
    /\bce soir\b/,
    /\bavant (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/,
  ];

  // Cas où le texte est une introduction ou une phrase de remplissage, pas une tâche.
  const NON_TASK_PATTERNS = [
    /\bvoici ce que\b/,
    /\bvoila ce que\b/,
    /\bce que je dois faire\b/,
  ];

  // Marqueurs qui ouvrent un nouveau point d'une liste dictée.
  const LIST_CUES = /^(ensuite|puis|apres|premierement|deuxiemement|troisiemement|quatriemement|enfin|finalement|premiere chose|en nouveau point|en dernier point|point suivant|au \d+e?( ou \d+e?)? point|on \d+e?( ou \d+e?)? point)\b/;

  // Mots de liaison à retirer en début de point (y compris ceux qui ne commencent pas une liste).
  const LEADING_FILLERS = /^(ensuite|puis|apr[eè]s|premi[eè]rement|deuxi[eè]mement|troisi[eè]mement|quatri[eè]mement|enfin|finalement|premi[eè]re chose|et aussi|donc|alors|bon|notamment|en nouveau point|en dernier point|point suivant|au \d+e?( ou \d+e?)? point|on \d+e?( ou \d+e?)? point)\b[ ,]*/i;

  const STOPWORDS = new Set([
    'alors', 'aussi', 'avec', 'avoir', 'beaucoup', 'bien', 'comme', 'dans', 'donc',
    'elle', 'elles', 'etre', 'faire', 'mais', 'meme', 'nous', 'pour',
    'quand', 'quel', 'quelle', 'quels', 'quelles', 'qui', 'sans', 'sont', 'tout',
    'toute', 'tous', 'tres', 'vous', 'cette', 'ces', 'dont', 'leur',
    'leurs', 'plus', 'pas', 'fait', 'aller', 'peut', 'peuvent', 'entre',
  ]);

  // Met en minuscule et retire les accents, pour comparer sans se soucier de la forme.
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

  // Vrai si le mot est un verbe d'action, à l'infinitif ou à l'impératif « -ez ».
  function isActionWord(word) {
    const w = normalize(word).replace(/[^a-z]/g, '');
    if (ACTION_VERBS.has(w)) return true;
    if (w.endsWith('ez')) return ACTION_VERBS.has(w.slice(0, -2) + 'er') || ACTION_VERBS.has(w.slice(0, -2) + 'ir');
    return false;
  }

  // Retire les mots de liaison et les expressions de remplissage en début de point.
  function cleanItem(sentence) {
    let s = sentence.trim();
    let previous;
    do {
      previous = s;
      s = s.replace(LEADING_FILLERS, '').trim();
      // Expression floue du type « en trans suiv suivant » : on repart du premier verbe d'action proche du début.
      const words = s.split(/\s+/);
      const idx = words.slice(0, 6).findIndex(isActionWord);
      if (idx > 0 && words.length - idx > 2 && !isActionWord(words[0])) {
        s = words.slice(idx).join(' ');
      }
    } while (s !== previous);
    s = s.replace(/,?\s*je ne sais plus\.?/gi, '').replace(/\s{2,}/g, ' ').trim();
    // « Donc, notamment, si ils ont… » est une précision du point précédent : on enlève le « donc » de tête.
    return s;
  }

  // Découpe le texte en points : une phrase qui commence par un marqueur de liste (« Ensuite », « Première chose »…)
  // ou par un verbe d'action ouvre un nouveau point. Les autres phrases se rattachent au point précédent.
  function splitItems(text) {
    const items = [];
    for (const sentence of splitSentences(text)) {
      const normalized = normalize(sentence);
      const startsWithCue = LIST_CUES.test(normalized);
      const firstWord = normalized.match(/^[a-z]+/)?.[0] ?? '';
      const startsWithAction = isActionWord(firstWord);
      const previous = items[items.length - 1];
      if (startsWithCue || startsWithAction) {
        items.push({ text: sentence, fromList: true });
      } else if (previous?.fromList) {
        // Précision d'un point de liste (« Donc, notamment, si ils ont… ») : on la rattache à ce point.
        previous.text += ` ${sentence}`;
      } else {
        items.push({ text: sentence, fromList: false });
      }
    }
    return items;
  }

  // Renvoie les points qui ressemblent à une tâche à faire, nettoyés et sans doublon.
  function extractTasks(text) {
    const seen = new Set();
    const tasks = [];
    for (const item of splitItems(text)) {
      const normalized = normalize(item.text);
      if (NON_TASK_PATTERNS.some((re) => re.test(normalized))) continue;

      const cleaned = item.fromList ? cleanItem(item.text) : item.text.trim();
      const cleanedNorm = normalize(cleaned);
      const hasAction = isActionWord(cleanedNorm.match(/^[a-z]+/)?.[0] ?? '');
      const hasPattern = TASK_PATTERNS.some((re) => re.test(cleanedNorm));
      // Un point de liste sans verbe d'action (« 4e ou 5e point ») n'est pas une tâche exploitable.
      if (!hasAction && !hasPattern) continue;
      if (cleaned.length < 4) continue;

      const key = cleanedNorm.replace(/[^a-z0-9]/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
    }
    return tasks;
  }

  // Résumé : si le texte est une liste de tâches, un comptage et les intitulés courts.
  // Sinon, les phrases les plus riches en mots fréquents, dans l'ordre d'origine.
  function summarize(text, maxSentences = 3) {
    const tasks = extractTasks(text);
    if (tasks.length > 0) {
      const short = (t) => {
        const words = t.split(/\s+/);
        return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : t;
      };
      const count = `${tasks.length} tâche${tasks.length > 1 ? 's' : ''} détectée${tasks.length > 1 ? 's' : ''}.`;
      return [count, ...tasks.map(short)];
    }

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

  // Distance de Levenshtein, pour retrouver les formes proches d'un mot du glossaire.
  function levenshtein(a, b) {
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
        diag = tmp;
      }
    }
    return prev[b.length];
  }

  // Corrige les mots du texte qui ressemblent à un terme du glossaire (ex. « ta glitte » → « Taglit »).
  // Compare chaque mot seul, puis chaque paire de mots collés, sans accents ni casse.
  function applyGlossary(text, terms) {
    const cleanTerms = (terms || []).map((t) => t.trim()).filter(Boolean);
    if (cleanTerms.length === 0) return text;

    const targets = cleanTerms.map((term) => ({
      term,
      key: normalize(term).replace(/[^a-z0-9]/g, ''),
    }));
    const words = [...text.matchAll(/\S+/g)].map((m) => ({ raw: m[0], start: m.index, end: m.index + m[0].length }));

    const findMatch = (k) => {
      for (const span of [2, 1]) {
        if (k + span > words.length) continue;
        const candidate = normalize(words.slice(k, k + span).map((w) => w.raw).join('')).replace(/[^a-z0-9]/g, '');
        if (candidate.length < 3) continue;
        for (const { term, key } of targets) {
          const threshold = Math.max(1, Math.round(key.length * 0.3));
          if (levenshtein(candidate, key) <= threshold) return { term, span };
        }
      }
      return null;
    };

    let result = '';
    let cursor = 0;
    let k = 0;
    while (k < words.length) {
      const match = findMatch(k);
      if (match) {
        const first = words[k];
        const last = words[k + match.span - 1];
        result += text.slice(cursor, first.start) + match.term;
        cursor = last.end;
        k += match.span;
      } else {
        k += 1;
      }
    }
    return result + text.slice(cursor);
  }

  const api = { splitSentences, splitItems, extractTasks, summarize, applyGlossary, levenshtein };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Analysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
