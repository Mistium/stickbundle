// Reporting a message in a DM or a group chat to Nookara staff (POST /api/report/dm-message on Nookara). Pure helpers,
// no store imports, so node --test can check them; the dialog itself is reportDmMessage() in report.js.

// the reason dropdown: [value the server takes, label]
export const DM_REPORT_REASONS = [
  ['harassment', 'Harassment'],
  ['spam', 'Spam'],
  ['child_safety', 'Child sexual abuse material'],
  ['nsfw', 'NSFW / explicit content'],
  ['threats', 'Threats or self-harm'],
  ['other', 'Something else'],
];
// (the numbers are BEFORE / AFTER in Nookara's dm-reports.js, and privacy policy section 5 says the same)
export const DM_REPORT_NOTES = {
  en: "Nookara staff will see this message and a short history of the chat around it: up to 10 messages before and 5 after, from everyone in this conversation. Pictures, videos and files in those messages are copied for staff, so they stay visible to staff even if the sender deletes them later. Staff don't see the rest of the chat, and the person you report isn't told who reported them.",
  de: "Das Nookara-Team sieht diese Nachricht und einen kurzen Verlauf des Chats drumherum: bis zu 10 Nachrichten davor und 5 danach, von allen in dieser Unterhaltung. Bilder, Videos und Dateien in diesen Nachrichten werden für das Team kopiert und bleiben für das Team sichtbar, auch wenn die Person sie später löscht. Den Rest des Chats sieht das Team nicht, und die gemeldete Person erfährt nicht, wer sie gemeldet hat.",
  pt: "A equipe da Nookara verá esta mensagem e um pequeno histórico da conversa em volta dela: até 10 mensagens antes e 5 depois, de todas as pessoas nesta conversa. Imagens, vídeos e arquivos nessas mensagens são copiados para a equipe e continuam visíveis para ela mesmo que quem enviou os apague depois. A equipe não vê o resto da conversa, e a pessoa denunciada não fica sabendo quem a denunciou.",
};
// A DM is end-to-end encrypted, so here it's the reporter's own app that opens things up, and the screen says that before they send (Ikelene, 2026-11-05: "make that clear when making a report")
export const DM_REPORT_E2EE_NOTES = {
  en: "This chat is end-to-end encrypted, so Nookara can't normally read it. If you send this report, your app unlocks this message and the messages around it (up to 10 before and 5 after, from both of you), with their pictures, videos, voice messages and files, and sends them to Nookara so moderators can read them. Those copies are not encrypted any more, and they stay with the report even if the sender deletes them later. Moderators don't get the rest of the chat, and the person you report isn't told who reported them.",
  de: "Dieser Chat ist Ende-zu-Ende-verschlüsselt, Nookara kann ihn also normalerweise nicht lesen. Wenn du diese Meldung abschickst, entschlüsselt deine App diese Nachricht und die Nachrichten drumherum (bis zu 10 davor und 5 danach, von euch beiden) samt Bildern, Videos, Sprachnachrichten und Dateien und schickt sie an Nookara, damit das Moderationsteam sie lesen kann. Diese Kopien sind nicht mehr verschlüsselt und bleiben bei der Meldung, auch wenn die Person sie später löscht. Den Rest des Chats bekommt das Moderationsteam nicht, und die gemeldete Person erfährt nicht, wer sie gemeldet hat.",
  pt: "Esta conversa tem criptografia de ponta a ponta, então a Nookara normalmente não consegue lê-la. Se você enviar esta denúncia, seu app desbloqueia esta mensagem e as mensagens em volta dela (até 10 antes e 5 depois, de vocês dois), com imagens, vídeos, mensagens de voz e arquivos, e as envia para a Nookara para que a moderação possa lê-las. Essas cópias deixam de ser criptografadas e continuam com a denúncia mesmo que quem enviou as apague depois. A moderação não recebe o resto da conversa, e a pessoa denunciada não fica sabendo quem a denunciou.",
};
// Ember has no language setting of its own: the browser's language decides, English when it's something else
export const dmReportNote = (lang = globalThis.navigator?.language, kind = 'group') => {
  const notes = kind === 'dm' ? DM_REPORT_E2EE_NOTES : DM_REPORT_NOTES;
  return notes[String(lang || '').slice(0, 2).toLowerCase()] || notes.en;
};
export const DM_REPORT_NOTE = DM_REPORT_NOTES.en;

// can this message in this view be reported to Nookara? (a DM or group message someone else sent, already saved)
export function canReportDm(view, m, meName) {
  if (!view || !m || m.system || m.pending || m.failed || m.ephemeral) return false;
  const author = m.author?.username;
  if (!author || (meName && author.toLowerCase() === String(meName).toLowerCase())) return false;
  if (view.kind === 'dm') return view.username !== 'System' && !!m.imId;
  if (view.kind === 'group') return !!view.room && !!m.gid;
  return false;
}

// the request body for a message (null when it can't be reported)
export function dmReportBody(view, m, reason, details) {
  if (!DM_REPORT_REASONS.some(([v]) => v === reason)) return null;
  const text = String(details || '').trim().slice(0, 1000);
  if (view?.kind === 'dm' && m?.imId) return { message_id: String(m.imId), reason, ...(text ? { details: text } : {}) };
  if (view?.kind === 'group' && m?.gid && view.room) return { room: view.room, message_id: String(m.gid), reason, ...(text ? { details: text } : {}) };
  return null;
}

// what the server's error codes mean to the person reporting
export function dmReportError(code, message) {
  return ({
    not_a_participant: "You can only report messages in your own conversations.",
    message_not_found: "That message doesn't exist any more.",
    reveal_required: "This device can't open that message, so it can't be reported from here. Try a device that can read it.",
    e2ee_locked: 'Unlock your DMs on this device first.',
    cannot_report_self: "You can't report your own message.",
    cannot_report_system: "That message can't be reported.",
    rate_limited: message || "You've sent a lot of reports - try again in an hour.",
    auth_required: 'Sign in with Nookara to report.',
  })[code] || "Couldn't send that report - try again in a moment.";
}
