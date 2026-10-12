// Lancer avec : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { splitSentences, extractTasks, summarize, applyGlossary, levenshtein } = require('../js/analysis.js');

test('splitSentences découpe sur la ponctuation et les retours à la ligne', () => {
  const parts = splitSentences('Bonjour. Il faut acheter du pain ! Et du lait ?\nMerci');
  assert.deepEqual(parts, ['Bonjour.', 'Il faut acheter du pain !', 'Et du lait ?', 'Merci']);
});

test('extractTasks repère les phrases avec une intention d\'action', () => {
  const text = 'Il fait beau aujourd\'hui. Il faut appeler le plombier. Je dois envoyer le devis demain. Merci beaucoup.';
  assert.deepEqual(extractTasks(text), [
    'Il faut appeler le plombier.',
    'Je dois envoyer le devis demain.',
  ]);
});

test('extractTasks ignore la casse et les accents', () => {
  const tasks = extractTasks('N\'OUBLIE PAS de Réserver la salle. Rappelle-moi de payer.');
  assert.equal(tasks.length, 2);
});

test('extractTasks supprime les doublons', () => {
  const tasks = extractTasks('Il faut payer la facture. il faut payer la facture.');
  assert.equal(tasks.length, 1);
});

test('extractTasks renvoie une liste vide sans tâche', () => {
  assert.deepEqual(extractTasks('Une discussion agréable sur la météo.'), []);
});

test('summarize renvoie tout quand le texte est court', () => {
  const text = 'Une phrase. Deux phrases.';
  assert.deepEqual(summarize(text, 3), ['Une phrase.', 'Deux phrases.']);
});

test('summarize garde le nombre demandé, dans l\'ordre d\'origine', () => {
  const text = [
    'Le projet avance bien avec la nouvelle équipe.',
    'La météo est agréable ce matin.',
    'Le projet demande encore des tests pour la nouvelle équipe.',
    'Le café était bon.',
    'Le budget du projet reste stable pour l\'équipe.',
  ].join(' ');
  const summary = summarize(text, 2);
  assert.equal(summary.length, 2);
  const indexes = summary.map((s) => text.indexOf(s));
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
});

test('liste dictée réelle : chaque point devient une tâche, sans l\'introduction', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'liste-taches.txt'), 'utf8');
  const tasks = extractTasks(text);
  assert.equal(tasks.length, 6);
  assert.match(tasks[0], /^Faire la demande de ETAIL/);
  assert.match(tasks[1], /^Finir avec Fortu Néo/);
  assert.match(tasks[2], /^Continuez le portfolio/);
  assert.match(tasks[4], /^Chercher les auto-écoles/);
  assert.match(tasks[4], /places pour des examens/);
  assert.match(tasks[5], /^Réviser le code de la route/);
  assert.ok(!tasks.some((t) => /voici ce que/i.test(t)));
  assert.ok(!tasks.some((t) => /4e ou 5e point/i.test(t)));
});

test('le résumé d\'une liste commence par le nombre de tâches', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'liste-taches.txt'), 'utf8');
  const summary = summarize(text, 3);
  assert.equal(summary[0], '6 tâches détectées.');
  assert.equal(summary.length, 7);
});

test('levenshtein compte les différences', () => {
  assert.equal(levenshtein('taglit', 'taglit'), 0);
  assert.equal(levenshtein('taglitte', 'taglit'), 2);
});

test('applyGlossary corrige les formes proches, y compris un mot coupé en deux', () => {
  const out = applyGlossary('faire la demande pour ta glitte et finir avec Fortu Néo', ['Taglit', 'Fortuneo']);
  assert.equal(out, 'faire la demande pour Taglit et finir avec Fortuneo');
});

test('applyGlossary ne touche pas aux mots sans rapport', () => {
  const text = 'Il fait beau aujourd\'hui.';
  assert.equal(applyGlossary(text, ['Taglit']), text);
  assert.equal(applyGlossary(text, []), text);
});
