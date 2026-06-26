// Minimal UI i18n.  Falls back to 'en' for unknown languages.

const TR: Record<string, Partial<Record<string, string>>> = {
  // ── Tab bar ──────────────────────────────────────────────────────────────
  'tab.library':    { en: 'Library',      it: 'Libreria',      de: 'Bibliothek',      fr: 'Bibliothèque', es: 'Biblioteca',  pt: 'Biblioteca' },
  'tab.glossary':   { en: 'Glossary',     it: 'Prontuario',    de: 'Glossar',         fr: 'Glossaire',    es: 'Glosario',    pt: 'Glossário' },
  'tab.settings':   { en: 'Settings',     it: 'Impostazioni',  de: 'Einstellungen',   fr: 'Réglages',     es: 'Ajustes',     pt: 'Configurações' },

  // ── Favorites ─────────────────────────────────────────────────────────────
  'fav.search':       { en: 'Search words…',           it: 'Cerca parole…',                  de: 'Wörter suchen…',              fr: 'Chercher des mots…',              es: 'Buscar palabras…',        pt: 'Pesquisar palavras…' },
  'fav.no_results':   { en: 'No results',               it: 'Nessun risultato',               de: 'Keine Ergebnisse',             fr: 'Aucun résultat',                  es: 'Sin resultados',          pt: 'Sem resultados' },
  'fav.no_words':     { en: 'No saved words yet',       it: 'Nessuna parola salvata',         de: 'Noch keine gespeicherten Wörter', fr: 'Aucun mot enregistré',          es: 'Sin palabras guardadas',  pt: 'Nenhuma palavra salva' },
  'fav.hint_search':  { en: 'Try a different search term.', it: 'Prova un termine diverso.',  de: 'Versuche einen anderen Begriff.', fr: 'Essayez un autre terme.',       es: 'Prueba con otro término.', pt: 'Tente outro termo.' },
  'fav.hint_empty':   { en: 'Save words from the reader using the ★ button.', it: 'Salva le parole dal lettore con il pulsante ★.', de: 'Speichere Wörter im Leser mit ★.', fr: 'Enregistrez des mots depuis le lecteur avec ★.', es: 'Guarda palabras con el botón ★.', pt: 'Guarde palavras com o botão ★.' },
  'fav.remove':       { en: 'Remove',                   it: 'Rimuovi',                        de: 'Entfernen',                   fr: 'Supprimer',                       es: 'Eliminar',                pt: 'Remover' },

  // ── Library ───────────────────────────────────────────────────────────────
  'lib.add_epub':        { en: '+ Add EPUB',              it: '+ Aggiungi EPUB',                de: '+ EPUB hinzufügen',            fr: '+ Ajouter EPUB',                  es: '+ Añadir EPUB',           pt: '+ Adicionar EPUB' },
  'lib.no_books':        { en: 'No books yet',            it: 'Nessun libro',                   de: 'Noch keine Bücher',            fr: 'Aucun livre',                     es: 'Sin libros aún',          pt: 'Nenhum livro ainda' },
  'lib.no_books_hint':   { en: 'Tap the button above to import your first book.', it: 'Premi il pulsante qui sopra per importare il primo libro.', de: 'Tippe auf die Schaltfläche oben, um das erste Buch zu importieren.', fr: 'Appuyez sur le bouton ci-dessus pour importer votre premier livre.', es: 'Toca el botón de arriba para importar tu primer libro.', pt: 'Toque no botão acima para importar o seu primeiro livro.' },
  'lib.import_error':    { en: 'Failed to import EPUB: ', it: 'Errore durante l\'importazione: ', de: 'Fehler beim EPUB-Import: ', fr: 'Échec de l\'importation : ', es: 'Error al importar: ', pt: 'Falha ao importar: ' },
  'lib.delete_confirm':  { en: 'Delete "{title}"?',       it: 'Eliminare "{title}"?',            de: '"{title}" löschen?',           fr: 'Supprimer "{title}" ?',           es: '¿Eliminar "{title}"?',    pt: 'Eliminar "{title}"?' },
  'lib.delete':          { en: 'Delete',                  it: 'Elimina',                         de: 'Löschen',                     fr: 'Supprimer',                       es: 'Eliminar',                pt: 'Eliminar' },
  'lib.importing':       { en: '…',                       it: '…',                               de: '…',                           fr: '…',                               es: '…',                       pt: '…' },
  'lib.server_section':  { en: 'Server',                  it: 'Server',                          de: 'Server',                      fr: 'Serveur',                         es: 'Servidor',                pt: 'Servidor' },
  'lib.local_section':   { en: 'On this device',          it: 'Su questo dispositivo',           de: 'Auf diesem Gerät',            fr: 'Sur cet appareil',                es: 'En este dispositivo',     pt: 'Neste dispositivo' },
  'lib.uploading':       { en: 'Uploading…',              it: 'Caricamento…',                    de: 'Hochladen…',                  fr: 'Envoi…',                          es: 'Subiendo…',               pt: 'A enviar…' },
  'lib.upload_error':    { en: 'Upload failed: ',         it: 'Errore di caricamento: ',         de: 'Upload fehlgeschlagen: ',     fr: 'Échec de l\'envoi : ',            es: 'Error al subir: ',        pt: 'Falha no envio: ' },
  'lib.quota_error':     { en: 'Server storage full (quota exceeded)', it: 'Spazio server esaurito (quota superata)', de: 'Serverspeicher voll', fr: 'Stockage serveur plein', es: 'Almacenamiento del servidor lleno', pt: 'Armazenamento do servidor cheio' },
  'lib.open_error':      { en: 'Error opening book: ',   it: 'Errore apertura libro: ',         de: 'Fehler beim Öffnen: ',        fr: 'Erreur d\'ouverture : ',          es: 'Error al abrir: ',        pt: 'Erro ao abrir: ' },
  'lib.quota':           { en: 'Storage: {used} / {total} MB', it: 'Spazio: {used} / {total} MB', de: 'Speicher: {used} / {total} MB', fr: 'Stockage : {used} / {total} Mo', es: 'Almacenamiento: {used} / {total} MB', pt: 'Armazenamento: {used} / {total} MB' },

  // ── Context mode ──────────────────────────────────────────────────────────
  'ctx.fast_label':   { en: 'Fast',       it: 'Veloce',    de: 'Schnell',  fr: 'Rapide',  es: 'Rápido',  pt: 'Rápido' },
  'ctx.medium_label': { en: 'Medium',     it: 'Medio',     de: 'Mittel',   fr: 'Moyen',   es: 'Medio',   pt: 'Médio' },
  'ctx.slow_label':   { en: 'Slow',       it: 'Lento',     de: 'Langsam',  fr: 'Lent',    es: 'Lento',   pt: 'Lento' },
  'ctx.fast_desc':    { en: '~1 sentence',     it: '~1 frase',      de: '~1 Satz',    fr: '~1 phrase',    es: '~1 frase',    pt: '~1 frase' },
  'ctx.medium_desc':  { en: '~1 paragraph',    it: '~1 paragrafo',  de: '~1 Absatz',  fr: '~1 paragraphe',es: '~1 párrafo',  pt: '~1 parágrafo' },
  'ctx.slow_desc':    { en: '~3 paragraphs',   it: '~3 paragrafi',  de: '~3 Absätze', fr: '~3 paragraphes',es: '~3 párrafos', pt: '~3 parágrafos' },
  'ctx.hint':         { en: 'more context = better quality, slower', it: 'più contesto = qualità migliore, più lento', de: 'mehr Kontext = bessere Qualität, langsamer', fr: 'plus de contexte = meilleure qualité, plus lent', es: 'más contexto = mejor calidad, más lento', pt: 'mais contexto = melhor qualidade, mais lento' },
}

export function t(key: string, lang: string, vars?: Record<string, string>): string {
  const map = TR[key]
  if (!map) return key
  let s = map[lang] ?? map['en'] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, v)
    }
  }
  return s
}
