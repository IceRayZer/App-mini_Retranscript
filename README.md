# Retranscription

Application web gratuite de retranscription vocale en français, sans compte, sans clé API et sans abonnement.
Elle s'installe sur l'écran d'accueil du téléphone comme une application.

## Utilisation

- **Enregistrer** : démarre la retranscription. Le texte apparaît en direct.
- **Pause / Reprendre** : suspend la capture. Rien n'est transcrit pendant la pause.
- **Arrêt** (carré) : termine l'enregistrement, sauvegarde le texte sur le téléphone et affiche :
  - l'onglet **Transcription** (copier, exporter en `.txt`, supprimer) ;
  - l'onglet **Tâches et résumé** (phrases d'action détectées et résumé simple).

Les retranscriptions restent uniquement dans le navigateur du téléphone.

## Installer sur l'écran d'accueil

1. Ouvrir l'adresse de l'application dans **Chrome sur Android** (recommandé).
2. Menu ⋮ puis **Installer l'application** (ou **Ajouter à l'écran d'accueil**).
3. Autoriser le micro à la première utilisation.

Sur iPhone, utiliser Safari, puis **Partager → Sur l'écran d'accueil**. La reconnaissance vocale y est moins fiable.

## Limites connues

- La reconnaissance vocale utilise le service intégré du navigateur (gratuit). Sur Chrome, l'audio est traité par Google : il n'est donc pas 100 % local.
- Le français est la langue de référence. Les mots en langue étrangère au milieu d'une phrase sont souvent mal transcrits.
- Les tâches et le résumé sont détectés par règles simples, sans intelligence artificielle.

## Développement

Aucune dépendance ni étape de build : HTML, CSS et JavaScript purs.

```bash
python3 -m http.server 8000   # puis ouvrir http://localhost:8000
node --test tests/analysis.test.js
```

Structure :

- `index.html`, `css/styles.css` : interface
- `js/app.js` : enregistrement, pause, arrêt, reconnaissance vocale
- `js/analysis.js` : détection des tâches et résumé (fonctions pures, testées)
- `manifest.webmanifest`, `sw.js`, `icons/` : installation et mode hors ligne
