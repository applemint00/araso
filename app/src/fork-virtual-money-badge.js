export const FORK_VIRTUAL_MONEY_BADGE_TEXT = "virtual money · fork";

export function forkVirtualMoneySurface({ fork = false, ownKind = "", ownStage = "", moveDir = "", moveStep = "", giftBack = false, jobApproval = false } = {}) {
  if (fork !== true) return null;
  if (ownKind === "money") return "money";
  if (ownKind === "gift" && ownStage === "pick") return giftBack === true ? "gift-back-send" : "gift-amount-send";
  if (ownKind === "move" && moveDir === "in") return `move-in-${moveStep || "unknown"}`;
  if (jobApproval === true) return "job-send";
  return null;
}

export function mountForkVirtualMoneyBadge({ document, isFork, jobApproval } = {}) {
  if (!document || typeof document.addEventListener !== "function") return { sync() {}, destroy() {} };
  let surface = null;
  let dismissed = false;
  const remove = () => document.querySelector(".a979-forkBadge")?.remove();
  const current = () => {
    const own = document.querySelector(".a911-screen");
    return forkVirtualMoneySurface({
      fork: typeof isFork === "function" ? isFork() === true : isFork === true,
      ownKind: own?.dataset?.a911 || "",
      ownStage: own?.dataset?.a911Stage || "",
      moveDir: own?.querySelector?.('[data-a905-view="move"]')?.dataset?.a905Dir || "",
      moveStep: own?.querySelector?.('[data-a905-view="move"]')?.dataset?.a905Step || "",
      giftBack: Boolean(own?.querySelector?.(".a911-card.is-picked.is-flipped")),
      jobApproval: typeof jobApproval === "function" ? jobApproval() === true : jobApproval === true,
    });
  };
  const sync = () => {
    const next = current();
    if (next !== surface) { surface = next; dismissed = false; }
    if (!surface || dismissed) { remove(); return; }
    if (document.querySelector(".a979-forkBadge")) return;
    const badge = document.createElement("div");
    badge.className = "a979-forkBadge";
    badge.dataset.a979Surface = surface;
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = FORK_VIRTUAL_MONEY_BADGE_TEXT;
    document.body.appendChild(badge);
  };
  const dismiss = () => {
    if (!surface || !document.querySelector(".a979-forkBadge")) return;
    dismissed = true;
    remove();
  };
  document.addEventListener("pointerdown", dismiss, { capture: true, passive: true });
  return {
    sync,
    destroy() {
      document.removeEventListener("pointerdown", dismiss, { capture: true });
      remove();
      surface = null;
      dismissed = false;
    },
  };
}
