// what a file is, going by its name: the attachment file card (Messages.jsx) and the Drive card (LinkEmbeds.jsx) say the same things.
export const fmtSize = n => (!n ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`);
export const RISKY = /^(exe|msi|bat|cmd|com|scr|ps1|vbs|vbe|js|jse|wsf|hta|jar|apk|dll|lnk|reg|cpl|msix|appx)$/;
export const KIND_OF = ext => (/^(zip|rar|7z|tar|gz|xz|bz2)$/.test(ext) ? 'Archive' : /^(exe|msi|msix|appx|apk|dmg|deb|appimage)$/.test(ext) ? 'Program'
  : /^(pdf)$/.test(ext) ? 'PDF' : /^(txt|md|rtf|log)$/.test(ext) ? 'Text' : /^(doc|docx|odt)$/.test(ext) ? 'Document' : /^(sb3|pmp|sb2)$/.test(ext) ? 'Scratch project'
  : /^(js|ts|jsx|tsx|py|json|html|css|c|cpp|cs|java|lua|sh|bat|cmd|ps1)$/.test(ext) ? 'Code' : 'File');
