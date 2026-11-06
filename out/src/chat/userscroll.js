// Did the PERSON just scroll (wheel / touch / scrollbar drag / keys)? Popups close on a scroll the person makes,
// but not on one the app makes itself (a new message sticking the chat to the bottom, history loading, layout shifts).
let last = 0;
const mark = () => { last = Date.now(); };
if (typeof document !== "undefined") {
  for (const t of ["wheel", "touchmove", "pointerdown", "keydown"]) document.addEventListener(t, mark, { capture: true, passive: true });
}
export const userScrolled = () => Date.now() - last < 350;
