# Retranscription

Application web gratuite de retranscription vocale en français, sans compte, sans clé API et sans abonnement.
Elle s'installe sur l'écran d'accueil du téléphone comme une application.

## Utilisation

- **Enregistrer** : démarre l'enregistrement audio. Le modèle de transcription se charge en arrière-plan.
- **Pause / Reprendre** : suspend l'enregistrement. Rien n'est capté pendant la pause.
- **Arrêt** (carré) : termine l'enregistrement, puis la transcription Whisper se fait sur le téléphone. Le résultat est sauvegardé et affiché avec :
  - l'onglet **Transcription** (copier, exporter en `.txt`, supprimer) ;
  - l'onglet **Tâches et résumé** (phrases d'action détectées et résumé simple).

Le modèle Whisper (`Xenova/whisper-small`, en précision complète, environ 1 Go) se télécharge **une seule fois**, au premier enregistrement. Sur un téléphone peu puissant, il peut être lent ou échouer par manque de mémoire. Il est ensuite gardé dans le navigateur, et les transcriptions suivantes ne téléchargent plus rien.

Les retranscriptions restent uniquement dans le navigateur du téléphone.

## Installer sur l'écran d'accueil

1. Ouvrir l'adresse de l'application dans **Chrome sur Android** (recommandé).
2. Menu ⋮ puis **Installer l'application** (ou **Ajouter à l'écran d'accueil**).
3. Autoriser le micro à la première utilisation.

Sur iPhone, utiliser Safari, puis **Partager → Sur l'écran d'accueil**. La reconnaissance vocale y est moins fiable.

## Limites connues

- La transcription se fait après l'arrêt, pas en direct. Pour un long enregistrement, ça peut prendre plusieurs minutes sur un téléphone.
- Le premier lancement nécessite une connexion pour télécharger le modèle. Ensuite, l'app fonctionne hors ligne.
- Les tâches et le résumé sont détectés par règles simples, sans intelligence artificielle. Une liste dictée avec « Ensuite », « Première chose » ou « en nouveau point » est découpée point par point.
- Le glossaire (« Mots à corriger ») corrige les formes proches d'un mot que tu as ajouté. Il ne peut pas retrouver un mot que le modèle n'a pas écrit.
- Non testé sur téléphone réel au moment de l'écriture : la transcription Whisper doit être vérifiée sur ton appareil.

## Développement

Aucune dépendance ni étape de build : HTML, CSS et JavaScript purs.

```bash
python3 -m http.server 8000   # puis ouvrir http://localhost:8000
node --test tests/analysis.test.js
```

Structure :

- `index.html`, `css/styles.css` : interface
- `js/app.js` : enregistrement, pause, arrêt, affichage des résultats
- `js/transcriber-worker.js` : moteur Whisper (Transformers.js) dans un worker
- `js/analysis.js` : détection des tâches et résumé (fonctions pures, testées)
- `manifest.webmanifest`, `sw.js`, `icons/` : installation et mode hors ligne
