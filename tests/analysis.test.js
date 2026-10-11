// Lancer avec : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitSentences, extractTasks, summarize } = require('../js/analysis.js');

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
