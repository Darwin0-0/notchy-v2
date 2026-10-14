(function (root) {
  'use strict';
  const storageKey = 'notchy-language-v1';
  const english = {
    'Langue': 'Language', 'Français': 'Français', 'English': 'English',
    'Scénarios': 'Scenarios', 'Réglage des scénarios': 'Scenario settings', 'Suivre ton activité': 'Follow your activity',
    'MODE': 'MODE', 'Mode des scénarios': 'Scenario mode', 'Auto · recommandé': 'Auto · recommended', 'Manuel': 'Manual',
    'Un focus démarre': 'A focus session starts', 'Une pause commence': 'A break begins', 'Première ouverture du jour (5 h – 11 h)': 'First opening of the day (5 am – 11 am)',
    'Rien ne tourne (ni minuteur ni média)': 'Nothing is running (no timer or media)', 'Première ouverture du jour': 'First opening of the day', 'Rien ne tourne': 'Nothing is running',
    'Changer de scénario quand un focus démarre': 'Change scenario when a focus session starts', 'Changer de scénario quand une pause commence': 'Change scenario when a break begins',
    'Changer de scénario à la première ouverture du jour': 'Change scenario at the first opening of the day', 'Changer de scénario quand rien ne tourne': 'Change scenario when nothing is running',
    'Ambiance': 'Ambience', 'Journée': 'Day', 'Complet': 'Complete', 'Minimal': 'Minimal', 'GARDE-FOUS': 'GUARDRAILS', 'LES 5 SCÉNARIOS': 'THE 5 SCENARIOS',
    'Message « Annuler » pendant 5 s': 'Show “Undo” for 5 seconds', 'Verrouiller 2 h après un choix manuel': 'Keep manual choices for 2 hours',
    'Ne pas changer pendant que j’utilise le panneau': 'Keep the layout while I use the panel', 'Revenir à l’accueil': 'Back to home',
    '{scenario} appliqué.': '{scenario} applied.', '{scenario} sera appliqué quand tu quitteras le panneau.': '{scenario} will be applied when you leave the panel.',
    'Disposition précédente rétablie.': 'Previous layout restored.', 'Choix manuel conservé pendant deux heures.': 'Manual choice kept for two hours.',
    'Aucun module disponible pour ce scénario.': 'No module is available for this scenario.', 'Les règles automatiques sont en pause.': 'Automatic rules are paused.',
    'Les changements suivent ton activité.': 'Layouts follow your activity.',
    'Annuler la disposition': 'Undo layout',
    'Encoche Notchy': 'Notchy notch', 'Ouvrir l’encoche': 'Open the notch', 'Réduire l’encoche': 'Collapse the notch', 'Encoche ouverte': 'Notch open',
    'Progression musicale': 'Music progress', 'Progression Focus': 'Focus progress', 'Progression LocalSend': 'LocalSend progress',
    'Déposer dans l’Étagère': 'Drop into the Shelf', 'Voir le résultat': 'View the result', 'Passer à la prochaine phase': 'Skip to the next phase',
    'Navigation de Notchy': 'Notchy navigation', 'Accueil de Notchy': 'Notchy home', 'Accueil Notchy': 'Notchy home',
    'Déposer des fichiers': 'Drop files', 'Relâche pour choisir une action.': 'Release to choose an action.',
    'Partage LocalSend': 'LocalSend sharing', 'Envoyer à…': 'Send to…', 'Fermer le partage': 'Close sharing',
    'Proposition de réception LocalSend': 'Incoming LocalSend request', 'DEMANDE DE PARTAGE': 'SHARING REQUEST', 'Refuser': 'Decline', 'Accepter': 'Accept',
    'Appareils à proximité': 'Nearby devices', 'Ouvre LocalSend sur l’autre appareil et connecte-le au même réseau Wi-Fi.': 'Open LocalSend on the other device and connect it to the same Wi-Fi network.',
    'Recherche d’appareils à proximité…': 'Looking for nearby devices…', 'Rechercher': 'Search', 'Annuler le transfert': 'Cancel the transfer',
    'Progression du transfert LocalSend': 'LocalSend transfer progress', 'Voir l’Étagère': 'View the Shelf', 'Terminé': 'Done', 'Renvoyer': 'Send again',
    'Modules de l’accueil': 'Home modules', 'À toi de composer ton Nook.': 'Make your Nook your own.', 'Clic droit pour choisir les modules.': 'Right-click to choose your modules.',
    'Musique': 'Music', 'Aucune lecture': 'Nothing playing', 'Lance un titre dans Spotify ou un autre lecteur. Il apparaîtra ici.': 'Play a track in Spotify or another player. It will appear here.',
    'Ouvrir Spotify': 'Open Spotify', 'EN LECTURE': 'NOW PLAYING', 'Ouvrir le lecteur': 'Open the player', 'Position dans le morceau': 'Track position',
    'Lecture aléatoire': 'Shuffle', 'Morceau précédent': 'Previous track', 'Morceau suivant': 'Next track', 'Lire': 'Play', 'Mettre en pause': 'Pause',
    'Activer la répétition de la liste': 'Enable queue repeat', 'Répétition': 'Repeat', 'Afficher À suivre': 'Show Up next', 'Fermer À suivre': 'Close Up next', 'À suivre': 'Up next',
    'Actualiser la file': 'Refresh the queue', 'Actualiser': 'Refresh', 'Fermer': 'Close', 'Connecter Spotify': 'Connect Spotify', 'Titres à suivre': 'Upcoming tracks',
    'Lecture sur l’appareil Spotify actif': 'Playback on your active Spotify device', 'Déconnecter': 'Disconnect',
    'Actions de fichier': 'File actions', 'Dépose un fichier sur l’encoche': 'Drop a file on the notch', 'Partager, extraire le texte ou convertir.': 'Share, extract text or convert.',
    'Choisir un fichier': 'Choose a file', 'Fichier précédent': 'Previous file', 'Fichier suivant': 'Next file', 'Fermer le fichier': 'Close the file', 'Extraire le texte': 'Extract text',
    'Garder': 'Keep', 'Convertir': 'Convert', 'Format de conversion': 'Conversion format', 'SVG contenant l’image originale': 'SVG containing the original image',
    'Retour aux actions': 'Back to actions', 'Traitement…': 'Processing…', 'Annuler': 'Cancel', 'Texte extrait': 'Text extracted', 'Copier': 'Copy', 'Corriger': 'Edit',
    'Enregistrer': 'Save', 'Télécharger': 'Download', 'Autre action': 'Another action', 'Choisir un appareil LocalSend': 'Choose a LocalSend device', 'Annuler l’envoi': 'Cancel sending',
    'Étagère de fichiers': 'File Shelf', 'Étagère': 'Shelf', 'Tout sélectionner': 'Select all', 'Tout désélectionner': 'Deselect all', 'Ajouter des fichiers': 'Add files',
    'Fichiers de l’Étagère': 'Shelf files', 'Rien ici pour l’instant': 'Nothing here yet', 'Dépose tes fichiers sur l’encoche': 'Drop your files on the notch',
    'ou clique pour les choisir.': 'or click to choose them.', 'Actions du fichier sélectionné': 'Selected file actions', 'Ouvrir': 'Open', 'Aperçu': 'Preview',
    'Afficher la copie dans le dossier': 'Show the copy in its folder', 'Dans le dossier': 'In the folder', 'Aucun fichier sélectionné': 'No files selected', 'Partager': 'Share', 'Retirer': 'Remove',
    'Partage à proximité': 'Nearby sharing', 'À proximité': 'Nearby', 'Rechercher des appareils LocalSend': 'Find LocalSend devices',
    'Ouvre LocalSend sur ton appareil, puis recherche.': 'Open LocalSend on your device, then search.', 'Les appareils LocalSend apparaîtront ici.': 'LocalSend devices will appear here.',
    'Météo': 'Weather', 'MÉTÉO': 'WEATHER', 'Utiliser ma position actuelle': 'Use my current location', 'Position actuelle': 'Current location', 'Actualiser la météo': 'Refresh the weather',
    'Météo indisponible': 'Weather unavailable', 'Réessayer': 'Try again', 'Choisir une ville': 'Choose a city', 'Changer de ville': 'Change city', 'Choisis une ville': 'Choose a city',
    'maintenant': 'now', ' à ': ' in ', ', il fait ': ', it is ', ' et ': ' and ', ' Ressenti ': ' Feels like ', 'pluie': 'rain', 'indisponible': 'unavailable',
    'prochaines 2 h': 'next 2 hours', 'Prochaines heures': 'Next hours', 'Revenir à la météo': 'Back to the weather', 'Rechercher une ville': 'Find a city',
    'Nom de la ville': 'City name', 'Villes trouvées': 'Cities found', 'Bienvenue dans Notchy': 'Welcome to Notchy',
    'Gestion des modules': 'Module management', 'Personnaliser l’accueil': 'Customize home', 'Choisis un module, puis un emplacement.': 'Choose a module, then a position.',
    'Choisis un module, puis un emplacement. Le glisser-déposer échange les modules. Échap annule l’édition.': 'Choose a module, then a position. Drag and drop to swap modules. Escape cancels editing.',
    'Retirer le module': 'Remove the module', 'Modules disponibles': 'Available modules', 'Annuler les changements': 'Cancel changes', 'Appliquer la disposition': 'Apply the layout', 'Appliquer': 'Apply',
    'Réglages de Notchy': 'Notchy settings', 'Ton Notchy': 'Your Notchy', 'Quelques réglages, à ton rythme.': 'A few settings, at your own pace.', 'Fermer les réglages': 'Close settings',
    'Ton espace': 'Your space', 'Format': 'Size', 'Compact': 'Compact', 'Équilibré': 'Balanced', 'Confort': 'Roomy', 'Arrondis': 'Corners', 'Arrondis de l’encoche': 'Notch corners',
    'Animations': 'Animations', 'L’essentiel': 'The essentials', 'Tâches & Pomodoro': 'Tasks & Pomodoro', 'Trouve ton rythme.': 'Find your rhythm.', 'Partager à proximité': 'Share nearby',
    'Redécouvrir Notchy': 'Rediscover Notchy', 'Léger': 'Subtle', 'Doux': 'Soft', 'Focus & tâches': 'Focus & tasks',
    'Fais place à ton rythme.': 'Make room for your rhythm.', 'Musique, focus et fichiers. Juste quand tu en as besoin.': 'Music, focus and files. Just when you need them.',
    'Découvrir': 'Explore', 'Passer': 'Skip', 'Précédent': 'Previous', 'Suivant': 'Next', 'C’est parti': 'Let’s go',
    'Un aperçu, un clic.': 'A glance, a click.', 'Survole l’encoche pour un aperçu. Clique pour ouvrir tes modules.': 'Hover over the notch for a preview. Click to open your modules.',
    'Une tâche, un temps pour elle.': 'One task, time for it.', 'Ajoute ta tâche dans Focus, puis lance le Pomodoro. La pause arrive au bon moment.': 'Add your task in Focus, then start the Pomodoro. Your break arrives at the right time.',
    'Dépose. Garde. Partage.': 'Drop. Keep. Share.', 'Glisse un fichier sur l’encoche. Garde-le dans l’Étagère ou envoie-le avec LocalSend.': 'Drop a file on the notch. Keep it in the Shelf or send it with LocalSend.',
    'Étape {step} sur {total} : {title}': 'Step {step} of {total}: {title}',
    'Conversion terminée': 'Conversion complete', 'Le résultat est prêt': 'Your result is ready', 'Nouveau morceau': 'New track', 'Musique reprise': 'Music resumed', 'Musique en pause': 'Music paused',
    'Cycle terminé': 'Cycle complete', 'Travail et pauses terminés': 'Focus and breaks complete', 'Focus arrêté': 'Focus stopped', 'Prêt pour une prochaine session': 'Ready for your next session',
    'Focus démarré': 'Focus started', 'Focus repris': 'Focus resumed', 'Focus en pause': 'Focus paused', 'SESSION TERMINÉE': 'SESSION COMPLETE', 'C’EST PRÊT': 'READY',
    'Un moment pour souffler': 'A moment to breathe', 'La pause a commencé': 'Your break has started', 'Voir Focus': 'View Focus', 'Voir la pause': 'View the break',
    'Session {session} sur {total}': 'Session {session} of {total}', '{completed} sur {total}': '{completed} of {total}',
    'Ajouter un module': 'Add a module', 'Libre': 'Empty', 'Aucun morceau en cours': 'Nothing playing', 'Focus · Prêt à commencer': 'Focus · Ready to start', 'Chargement…': 'Loading…',
    'Choisis une icône ci-dessous': 'Choose an icon below', 'Ajouter': 'Add', 'Choisis un module, puis son emplacement.': 'Choose a module, then its position.',
    'Emplacement {position} · {kind} · {module}': 'Position {position} · {kind} · {module}', 'affichage principal': 'main view', 'accès rapide': 'quick access', 'ajouter un module': 'add a module',
    'Retirer {module} de cet emplacement': 'Remove {module} from this position', 'le module': 'the module', '{module} · choisir un emplacement': '{module} · choose a position',
    ' · placé': ' · placed', '{module} placé.': '{module} placed.', '{module} retiré.': '{module} removed.', '{module} sélectionné. Choisis un emplacement.': '{module} selected. Choose a position.',
    'Changements annulés.': 'Changes cancelled.', 'Disposition appliquée pour cette fenêtre.': 'Layout applied for this window.', 'Disposition appliquée.': 'Layout applied.', 'Disposition enregistrée.': 'Layout saved.', 'Choix annulé.': 'Selection cancelled.',
    'À ajouter depuis l’accueil': 'Add it from home', ' en cours': ' in progress', 'Tâches et durée des sessions': 'Tasks and session duration', 'Prêt à partager à proximité': 'Ready to share nearby', 'Ouvrir le partage': 'Open sharing',
    'Aucun morceau': 'No track', 'Fichiers gardés': 'Saved files', 'Prêt à commencer': 'Ready to start', 'Ouvrir l’Étagère': 'Open the Shelf',
    '{count} fichier': '{count} file', '{count} fichiers': '{count} files', '{count} appareil': '{count} device', '{count} appareils': '{count} devices', '{count} sélectionné': '{count} selected', '{count} sélectionnés': '{count} selected',
    '{count} fichier reçu': '{count} file received', '{count} fichiers reçus': '{count} files received', '{count} fichier envoyé': '{count} file sent', '{count} fichiers envoyés': '{count} files sent',
    'Mo': 'MB', 'Ko': 'KB', 'Prêt à recevoir': 'Ready to receive', 'Demande de partage': 'Sharing request', 'Partage local': 'Local sharing', 'Réception': 'Receiving', 'Envoi': 'Sending',
    'Préparation de l’envoi': 'Preparing to send', 'Demande envoyée': 'Request sent', 'Réception de {device}': 'Receiving from {device}', 'Envoi en cours': 'Sending', 'Transfert interrompu': 'Transfer interrupted',
    'Revenir au panneau, le transfert continue': 'Back to the panel; the transfer continues', 'Annuler la réception': 'Cancel receiving', 'En attente d’acceptation': 'Waiting for acceptance', 'Préparation des fichiers': 'Preparing files',
    '{device} doit accepter la demande': '{device} needs to accept the request', 'Connexion à l’appareil sélectionné…': 'Connecting to the selected device…', 'Reçu': 'Received', 'Envoyé': 'Sent', ' vers ': ' to ', ' · Étagère': ' · Shelf',
    'Envoyer à {device}': 'Send to {device}', 'Choisis un appareil à proximité': 'Choose a nearby device', 'Aucun appareil pour le moment': 'No devices yet', 'Lancer la recherche sur le réseau local': 'Search the local network',
    'Appareil LocalSend': 'LocalSend device', 'veut envoyer ': 'wants to send ', 'Proposition de réception': 'Incoming request', 'Fichiers reçus dans l’Étagère': 'Files received in the Shelf', 'Envoi terminé': 'Sending complete',
    'Transfert annulé': 'Transfer cancelled', 'Recherche…': 'Searching…', 'Choisis un appareil': 'Choose a device', 'Prêt à recevoir · aucun appareil pour le moment': 'Ready to receive · no devices yet', 'Arrêter la recherche LocalSend': 'Stop LocalSend discovery',
    'Dans l’Étagère': 'In the Shelf', 'Fichiers reçus': 'Files received', 'Fichier reçu': 'File received', 'Fichiers envoyés': 'Files sent', 'Fichier envoyé': 'File sent', 'Transfert terminé': 'Transfer complete',
    'Demande refusée': 'Request declined', '{device} a refusé le partage.': '{device} declined sharing.', 'L’appareil': 'The device', 'Tu peux demander un nouvel envoi.': 'You can request another transfer.',
    'Le transfert a été arrêté.': 'The transfer was stopped.', 'Transfert interrompu à {percent} %': 'Transfer interrupted at {percent}%', 'Transfert impossible': 'Transfer unavailable',
    'Vérifie que les appareils utilisent le même réseau Wi-Fi.': 'Check that both devices use the same Wi-Fi network.', 'Relance l’envoi depuis l’appareil expéditeur.': 'Start sending again from the sending device.', 'Réessayer démarre un nouvel envoi depuis le début.': 'Trying again starts a new transfer from the beginning.',
    'Préparation du fichier…': 'Preparing the file…', 'Envoi du fichier…': 'Sending the file…', 'LocalSend reste disponible. OCR et conversion : 25 Mo maximum.': 'LocalSend remains available. OCR and conversion: 25 MB maximum.',
    'OCR : 25 Mo maximum. Le partage LocalSend reste disponible.': 'OCR: 25 MB maximum. LocalSend sharing remains available.', 'Conversion : 25 Mo maximum. Le partage LocalSend reste disponible.': 'Conversion: 25 MB maximum. LocalSend sharing remains available.',
    'Lecture du PDF…': 'Reading the PDF…', 'Reconnaissance du texte…': 'Recognizing text…', 'Conversion…': 'Converting…', 'Fichier prêt': 'File ready', 'Le SVG contient l’image ; il ne s’agit pas d’une vectorisation.': 'The SVG contains the image; it is not a vector conversion.',
    'Le traitement a échoué.': 'Processing failed.', 'Traitement annulé.': 'Processing cancelled.', '20 fichiers maximum à la fois.': 'Up to 20 files at a time.', 'Le texte ne peut pas être copié.': 'The text could not be copied.', 'Texte copié.': 'Text copied.',
    'Gardé dans l’Étagère.': 'Kept in the Shelf.', 'Fichier gardé': 'File kept', 'Envoi annulé.': 'Sending cancelled.', 'Fichier envoyé.': 'File sent.', 'Envoi en cours…': 'Sending…', 'Cette action a échoué.': 'This action failed.',
    'Le fichier ne peut pas être ouvert.': 'The file could not be opened.', 'Copie affichée dans son dossier Windows.': 'Copy shown in its Windows folder.', 'Copie ouverte dans Windows.': 'Copy opened in Windows.', 'Copie téléchargée. Ouvre-la depuis tes téléchargements.': 'Copy downloaded. Open it from your downloads.',
    'Ouvrir le fichier': 'Open the file', 'Ouvrir dans l’application par défaut': 'Open in the default app', 'Afficher l’aperçu': 'Show the preview', 'Télécharger une copie pour l’ouvrir': 'Download a copy to open it', 'Afficher l’image': 'Show the image', 'Aperçu indisponible pour ce format': 'Preview unavailable for this format',
    'Sélectionner {file}': 'Select {file}', 'L’Étagère ne répond pas correctement.': 'The Shelf is not responding correctly.', '20 fichiers maximum dans l’Étagère.': 'Up to 20 files in the Shelf.', 'Ajout {current} sur {total}…': 'Adding {current} of {total}…',
    'Déposer {count} fichier': 'Drop {count} file', 'Déposer {count} fichiers': 'Drop {count} files', 'Relâche pour les garder dans l’Étagère.': 'Release to keep them in the Shelf.', 'Relâche pour garder, convertir ou partager.': 'Release to keep, convert or share.',
    'Avancer ou reculer dans le morceau': 'Seek within the track', 'Le lecteur Windows ne permet pas de déplacer la lecture': 'The Windows player does not support seeking', 'Titre inconnu': 'Unknown title', 'Artiste inconnu': 'Unknown artist', 'lecteur musical': 'music player', ' · ouvrir le lecteur': ' · open the player',
    'Répéter ce morceau · passer sans répétition': 'Repeat this track · switch to no repeat', 'Répéter la liste · passer à un seul morceau': 'Repeat the queue · switch to one track', 'Le lecteur ne répond pas.': 'The player is not responding.', 'Le morceau a changé. Choisis sa nouvelle position.': 'The track changed. Choose its new position.',
    'Connecte Spotify pour afficher sa file.': 'Connect Spotify to view its queue.', 'Autorise la connexion dans ton navigateur.': 'Allow the connection in your browser.', 'La file est prête à être actualisée.': 'The queue is ready to refresh.', 'La file est vide.': 'The queue is empty.',
    'Reconnecte Spotify pour restaurer la session.': 'Reconnect Spotify to restore the session.', 'Spotify refuse cet accès pour ce compte.': 'Spotify denied access for this account.', 'Spotify demande une pause avant de réessayer.': 'Spotify needs a pause before trying again.', 'Spotify est momentanément indisponible.': 'Spotify is temporarily unavailable.',
    'La file Spotify est indisponible.': 'The Spotify queue is unavailable.', 'Impossible de lire la file pour le moment.': 'The queue cannot be read right now.', 'Lecture annulée.': 'Playback cancelled.', 'Commande indisponible.': 'Command unavailable.', 'Lecture demandée à Spotify…': 'Requesting playback from Spotify…', 'Chargement de la file…': 'Loading the queue…',
    'Autoriser la lecture Spotify': 'Allow Spotify playback', 'Lire {track} · {artists}': 'Play {track} · {artists}', 'Lire sur l’appareil Spotify actif · remplace le contexte de lecture': 'Play on the active Spotify device · replaces the playback context', 'Titre indisponible': 'Title unavailable', 'Épisode': 'Episode',
    'Ouvre cette vue dans l’application Windows pour connecter Spotify.': 'Open this view in the Windows app to connect Spotify.', 'La file Spotify est indisponible. Réessaie.': 'The Spotify queue is unavailable. Try again.', 'Lecture demandée à Spotify sur l’appareil actif.': 'Playback requested on the active Spotify device.', 'Spotify n’a pas pu lancer ce titre.': 'Spotify could not play this track.',
    'Actualisation de la météo…': 'Refreshing the weather…', 'Connexion au service météo.': 'Connecting to the weather service.', 'Vérifie ta connexion ou choisis une ville.': 'Check your connection or choose a city.', 'Changer de ville · {city}': 'Change city · {city}',
    'conditions indisponibles': 'conditions unavailable', 'CE SOIR': 'TONIGHT', 'AUJOURD’HUI': 'TODAY', ' Aujourd’hui, jusqu’à {temperature}°': ' Today, up to {temperature}°', ', avec {risk} % de risque de précipitations.': ', with a {risk}% chance of precipitation.', ' Avec {risk} % de risque de précipitations.': ' A {risk}% chance of precipitation.',
    ' · Dernière mise à jour : ': ' · Last updated: ', 'La météo est indisponible.': 'The weather is unavailable.', 'Recherche de la position actuelle…': 'Finding your current location…', 'Aucune ville trouvée.': 'No cities found.', 'Recherche des villes…': 'Searching for cities…', 'Saisis au moins deux lettres.': 'Enter at least two letters.',
    'prévue': 'expected', 'prévues': 'expected', 'précipitations': 'precipitation', 'sans pluie': 'no rain', 'au sec': 'dry', 'dernier relevé': 'last reading', 'prévision précédente · 2 h': 'previous forecast · 2 h',
    'Prévision des précipitations pour les deux prochaines heures indisponible.': 'Precipitation forecast for the next two hours unavailable.', 'Pluie prévue dans les deux prochaines heures.': 'Rain expected in the next two hours.', 'Précipitations prévues dans les deux prochaines heures.': 'Precipitation expected in the next two hours.',
    'Pas de pluie prévue dans les deux prochaines heures.': 'No rain expected in the next two hours.', 'Pas de précipitations prévues dans les deux prochaines heures.': 'No precipitation expected in the next two hours.', 'Prévision précédente · ': 'Previous forecast · ', 'dans les deux prochaines heures': 'in the next two hours', 'sur deux heures': 'over two hours',
    'Actualisation…': 'Refreshing…', 'Chargement de la météo…': 'Loading the weather…', 'Dernières données connues · actualisation indisponible.': 'Last known data · refresh unavailable.', 'Choisis une ville ou utilise ta position actuelle.': 'Choose a city or use your current location.',
    'Partage indisponible.': 'Sharing unavailable.', 'La recherche est indisponible.': 'Search unavailable.', 'L’aperçu de cette image est indisponible.': 'This image preview is unavailable.', 'Cette action est indisponible.': 'This action is unavailable.',
    'Ce fichier est indisponible.': 'This file is unavailable.', ' · gardé': ' · kept', 'à': 'in', 'à ': 'in ', 'ressenti': 'feels like', 'Météo · {city}': 'Weather · {city}', '{current} sur {total}': '{current} of {total}',
    'Ciel dégagé': 'Clear sky', 'Peu nuageux': 'Mostly clear', 'Partiellement nuageux': 'Partly cloudy', 'Couvert': 'Overcast', 'Brouillard': 'Fog', 'Bruine': 'Drizzle', 'Pluie': 'Rain', 'Neige': 'Snow', 'Orage': 'Thunderstorm', 'Conditions indisponibles': 'Conditions unavailable',
    'Météo indisponible. Vérifie ta connexion puis réessaie.': 'Weather unavailable. Check your connection, then try again.', 'Connexion au service météo impossible.': 'Unable to connect to the weather service.',
    'Windows refuse l’accès à la position. Autorise la localisation dans les paramètres Windows ou choisis une ville.': 'Windows denied location access. Allow location in Windows settings or choose a city.', 'La localisation Windows est désactivée. Active-la dans les paramètres Windows ou choisis une ville.': 'Windows location is turned off. Enable it in Windows settings or choose a city.',
    'Windows n’a pas pu déterminer la position à temps. Réessaie ou choisis une ville.': 'Windows could not find your location in time. Try again or choose a city.', 'Windows n’a fourni qu’une ancienne position. Réessaie ou choisis une ville.': 'Windows returned an old location. Try again or choose a city.', 'La position actuelle est indisponible sur cet ordinateur. Choisis une ville ou vérifie les paramètres Windows.': 'Current location is unavailable on this computer. Choose a city or check Windows settings.',
    'Service météo indisponible.': 'Weather service unavailable.', 'Recherche de ville indisponible. Vérifie ta connexion puis réessaie.': 'City search unavailable. Check your connection, then try again.', 'Choisis une ville valide dans les résultats.': 'Choose a valid city from the results.', 'Choisis une ville valide.': 'Choose a valid city.', 'Position indisponible. Choisis une ville.': 'Location unavailable. Choose a city.', 'Mise à jour indisponible — dernières données pour {city}.': 'Refresh unavailable — last known data for {city}.',
    'Aucun fichier n’a été accepté.': 'No files were accepted.', 'L’appareil n’a pas confirmé le fichier envoyé.': 'The device did not confirm the sent file.', 'La sélection de fichiers n’est plus disponible.': 'The selected files are no longer available.', 'Les liens de fichiers ne peuvent pas être partagés.': 'File links cannot be shared.', 'Le fichier a changé depuis sa sélection.': 'The file changed after it was selected.', '{phase} · {time} restantes': '{phase} · {time} remaining',
    'L’identité LocalSend est indisponible.': 'The LocalSend identity is unavailable.', 'L’identité LocalSend est invalide.': 'The LocalSend identity is invalid.', 'Certificat LocalSend invalide.': 'Invalid LocalSend certificate.', 'Certificat LocalSend manquant.': 'Missing LocalSend certificate.', 'Impossible de créer l’identité LocalSend.': 'Unable to create the LocalSend identity.',
    'LocalSend est fermé.': 'LocalSend is closed.', 'Appareil indisponible.': 'Device unavailable.', 'Cette proposition n’est plus disponible.': 'This request is no longer available.', 'Il n’y a pas assez de place dans l’étagère (20 fichiers maximum).': 'There is not enough room in the Shelf (20 files maximum).',
    'Ce transfert n’est plus actif.': 'This transfer is no longer active.', 'Cet appareil n’est plus à proximité.': 'This device is no longer nearby.', 'Un transfert est déjà en cours.': 'A transfer is already running.', 'Le transfert est resté sans activité.': 'The transfer timed out without activity.', 'La sélection de fichiers est invalide.': 'The selected files are invalid.', 'La taille totale du lot est invalide.': 'The total batch size is invalid.',
    'L’envoi a échoué. L’appareil est indisponible ou son identité TLS a changé.': 'Sending failed. The device is unavailable or its TLS identity changed.', 'Cet appareil demande un code PIN.': 'This device requires a PIN.', 'L’appareil a refusé le transfert.': 'The device declined the transfer.', 'L’appareil a refusé la préparation du transfert.': 'The device declined preparation of the transfer.', 'Réponse LocalSend invalide.': 'Invalid LocalSend response.', 'Le transfert a été interrompu.': 'The transfer was interrupted.',
    'La connexion au lecteur n’est pas disponible.': 'The player connection is unavailable.', 'Le lecteur n’a pas pu effectuer cette action.': 'The player could not perform this action.', 'Connexion musicale indisponible.': 'Music connection unavailable.', 'Connexion au lecteur en cours…': 'Connecting to the player…', 'La connexion Spotify est indisponible.': 'The Spotify connection is unavailable.',
    'TERMINÉ': 'DONE', 'EN PAUSE': 'PAUSED', 'PAUSE LONGUE': 'LONG BREAK', 'PAUSE': 'BREAK',
    'Cycle terminé. Prends un moment pour toi.': 'Cycle complete. Take a moment for yourself.', 'Prends un moment pour toi.': 'Take a moment for yourself.', 'Reprends quand tu es prêt.': 'Resume when you are ready.', 'Lève-toi et éloigne-toi de l’écran un moment.': 'Stand up and step away from your screen for a moment.',
    'Respire, bois un verre d’eau, puis retrouve ton rythme.': 'Breathe, drink some water, then find your rhythm again.', 'Une tâche, un moment pour avancer.': 'One task, one moment to move forward.', 'Pause longue': 'Long break', 'Pause courte': 'Short break',
    'Démarrer Focus': 'Start Focus', 'Démarrer': 'Start', 'Mettre Focus en pause': 'Pause Focus', 'Arrêter Focus': 'Stop Focus', 'Arrêter': 'Stop', 'Régler le Pomodoro': 'Set up Pomodoro', 'Réglages': 'Settings', '25 minutes': '25 minutes',
    'Reste régulier et garde le rythme.': 'Stay steady and keep your rhythm.', 'Progression de la session': 'Session progress', 'TÂCHE': 'TASK', 'Réglages Pomodoro': 'Pomodoro settings', 'Revenir au minuteur': 'Back to the timer', 'Retour': 'Back',
    'Durée de travail': 'Focus duration', 'Durée de travail en minutes': 'Focus duration in minutes', 'Pause courte en minutes': 'Short break in minutes', 'Pause longue en minutes': 'Long break in minutes', 'Sessions': 'Sessions', 'Nombre de sessions': 'Number of sessions',
    'Passer à la pause': 'Skip to the break', 'Tâches du Pomodoro': 'Pomodoro tasks', 'Tâches': 'Tasks', 'Ajouter une tâche': 'Add a task', 'Nouvelle tâche': 'New task', 'Ajouter la tâche': 'Add the task',
    'Une tâche suffit pour commencer. Choisis-la, puis lance le minuteur.': 'One task is enough to start. Pick it, then start the timer.', 'Concentration': 'Focus', '{minutes} minutes {seconds} secondes': '{minutes} minutes {seconds} seconds', 'À ton rythme': 'At your own pace',
    'Rouvrir : {task}': 'Reopen: {task}', 'Terminer : {task}': 'Complete: {task}', 'Choisir pour Focus : {task}': 'Choose for Focus: {task}', 'Supprimer : {task}': 'Delete: {task}', 'Terminer le cycle': 'Finish the cycle', 'Passer à la session suivante': 'Skip to the next session',
    'Minuteur Pomodoro · {phase} · {completed} cycles terminés sur {total}': 'Pomodoro timer · {phase} · {completed} of {total} cycles complete', 'Reprendre Focus': 'Resume Focus', 'Reprendre': 'Resume', 'Les durées restent fixes pendant le cycle en cours.': 'Durations stay fixed during the current cycle.', 'Les pauses s’enchaînent automatiquement.': 'Breaks begin automatically.',
    '{minutes} minutes': '{minutes} minutes', 'Tâche ajoutée.': 'Task added.', '100 tâches : retire une tâche pour en ajouter une.': '100 tasks: remove a task to add another.', 'Écris le nom de ta tâche.': 'Write your task’s name.'
  };
  function create(storage) {
    let language = 'fr'; const listeners = new Set();
    if (storage === undefined) try {storage = root?.localStorage;} catch {}
    try {if (storage?.getItem(storageKey) === 'en') language = 'en';} catch {}
    const locale = () => language;
    function t(source, values = {}) {
      const direct = Object.hasOwn(english, source), trimmed = typeof source === 'string' && Object.hasOwn(english, source.trim());
      const value = language === 'en' ? direct ? english[source] : trimmed ? source.replace(source.trim(), english[source.trim()]) : source : source;
      return typeof value === 'string' ? value.replace(/\{([a-zA-Z]+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match) : value;
    }
    function setLocale(value) {
      if (!['fr', 'en'].includes(value) || value === language) return false;
      language = value; try {storage?.setItem(storageKey, value);} catch {}
      for (const listener of [...listeners]) listener(value);
      return true;
    }
    const onChange = listener => {listeners.add(listener); return () => listeners.delete(listener);};
    const frenchMessages = Object.fromEntries(Object.entries(english).filter(([source, value]) => source !== value).map(([source, value]) => [value, source]));
    const message = value => t(Object.hasOwn(frenchMessages, value) ? frenchMessages[value] : value);
    // Only explicitly marked source HTML participates; user and generated text never does.
    function bind(document) {
      const entries = [];
      for (const element of document.querySelectorAll('[data-i18n],[data-i18n-aria-label],[data-i18n-title],[data-i18n-placeholder]')) {
        if (element.hasAttribute('data-i18n')) for (const node of element.childNodes) if (node.nodeType === 3 && node.nodeValue.trim()) entries.push({node, source: node.nodeValue});
        for (const attribute of ['aria-label', 'title', 'placeholder']) if (element.hasAttribute('data-i18n-' + attribute)) entries.push({element, attribute, source: element.getAttribute('data-i18n-' + attribute)});
      }
      return () => {document.documentElement.lang = language; for (const entry of entries) {if (entry.node) entry.node.nodeValue = t(entry.source); else entry.element.setAttribute(entry.attribute, t(entry.source));}};
    }
    return Object.freeze({locale, t, message, setLocale, onChange, bind});
  }
  const api = create();
  if (typeof module === 'object' && module.exports) module.exports = {...api, create};
  if (root) root.NotchyI18n = api;
})(typeof window === 'object' ? window : null);
