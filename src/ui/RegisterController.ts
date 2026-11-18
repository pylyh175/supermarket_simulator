// Register overlay — plain-DOM port of the 2D RegisterOverlay (Phaser) for the
// 3D slice. All game logic lives in the unit-tested session module; this
// controller is DOM glue: it reads session state, draws it, and forwards
// player intent back into the session functions. `render()` is the single
// place that writes the DOM. No Phaser, no save code — `document`/`window`
// only. Task 8 wires persistence into main.ts's creditMoney().
import "../ui/register.css";
import {
  createSession,
  scanNext,
  receivePayment,
  dispense,
  undoDispense,
  type Session,
} from "../register/session";
import { formatRinggit } from "../register/money";
import { DENOMS_SEN, DENOM_LABELS } from "../data/denominations";
import { makeChange } from "../register/change";
import type { Customer } from "../customers/generate";

const PAY_BEAT_MS = 1000;
const THANK_YOU_MS = 1000;
const NOPE_SHAKE_MS = 360;

/** Cozy flat palette for the conveyor chips, picked by a hash of the product id. */
const CHIP_COLORS = [
  "#f2b8a0",
  "#a8d5a2",
  "#f7d774",
  "#9cc3e5",
  "#d5b3e3",
  "#f4a7b9",
  "#bfe3d0",
  "#e8c39e",
];

function chipColorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return CHIP_COLORS[Math.abs(hash) % CHIP_COLORS.length];
}

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`RegisterController: missing #${id} in index.html`);
  }
  return el as T;
}

export interface RegisterClose {
  /** true when the sale finished (exact change given); false on Escape abandon. */
  completed: boolean;
}

export type RegisterCloseHandler = (result: RegisterClose) => void;

/**
 * Owns the `#register-ui` overlay. `open(customer)` wires the skeleton DOM to a
 * fresh session and shows it; every handler path runs through `render()`;
 * Escape abandons the sale (completed=false); an exact tender or an exact
 * change count reaches `done`, shows the thank-you banner for ~1 s, then
 * closes with completed=true. The close callback fires exactly once.
 */
export class RegisterController {
  private customer: Customer | null = null;
  private session: Session | null = null;
  private closed = true;
  private paymentScheduled = false;
  private finishScheduled = false;
  private hintOpen = false;
  private paymentTimer: number | null = null;
  private finishTimer: number | null = null;
  private nopeTimer: number | null = null;
  private closeHandler: RegisterCloseHandler | null = null;

  private readonly root: HTMLElement;
  private readonly avatarEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly tenderEl: HTMLElement;
  private readonly conveyorEl: HTMLElement;
  private readonly lcdMainEl: HTMLElement;
  private readonly lcdSubEl: HTMLElement;
  private readonly lcdGivenEl: HTMLElement;
  private readonly tooMuchEl: HTMLElement;
  private readonly hintBtn: HTMLButtonElement;
  private readonly hintTipEl: HTMLElement;
  private readonly changePadEl: HTMLElement;
  private readonly denomButtonsEl: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly thankYouEl: HTMLElement;

  constructor() {
    this.root = requireElement("register-ui");
    this.avatarEl = requireElement("customer-avatar");
    this.nameEl = requireElement("customer-name");
    this.tenderEl = requireElement("customer-tender");
    this.conveyorEl = requireElement("conveyor");
    this.lcdMainEl = requireElement("lcd-main");
    this.lcdSubEl = requireElement("lcd-sub");
    this.lcdGivenEl = requireElement("lcd-given");
    this.tooMuchEl = requireElement("too-much");
    this.hintBtn = requireElement<HTMLButtonElement>("hint-btn");
    this.hintTipEl = requireElement("hint-tip");
    this.changePadEl = requireElement("change-pad");
    this.denomButtonsEl = requireElement("denom-buttons");
    this.undoBtn = requireElement<HTMLButtonElement>("undo-btn");
    this.thankYouEl = requireElement("thankyou");

    // Announce the customer line politely — consistent with the 2D overlay.
    this.tenderEl.setAttribute("aria-live", "polite");

    this.buildChangePad();
    this.wireButtons();
  }

  /** Register the (single) close callback. Fires in the closing user gesture. */
  onClose(handler: RegisterCloseHandler): void {
    this.closeHandler = handler;
  }

  /** Show the overlay for `customer` and start a fresh session. */
  open(customer: Customer): void {
    // A stray double-open can't reset an in-flight sale.
    if (!this.closed) return;
    this.customer = customer;
    this.session = createSession(customer.basket.map((item) => ({ ...item })));
    this.closed = false;
    this.paymentScheduled = false;
    this.finishScheduled = false;
    this.hintOpen = false;
    this.clearTimers();

    this.buildChips();
    window.addEventListener("keydown", this.onKeyDown);
    this.root.hidden = false;
    this.render();
  }

  /** Abandon the sale from outside the overlay (same as Escape). */
  close(): void {
    this.closeTill(false);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.closed || !this.session) return;
    if (event.code === "KeyE") {
      event.preventDefault();
      this.scanFrontmost();
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      // In the "done" phase the sale is already settled — treat Escape as a
      // completed close rather than an abandon (money has been earned).
      this.closeTill(this.session.phase === "done");
    }
  };

  // ---- Building blocks ------------------------------------------------------

  private buildChips(): void {
    const session = this.session;
    if (!session) return;
    this.conveyorEl.innerHTML = "";
    session.items.forEach((item, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.style.setProperty("--i", String(index));
      chip.style.setProperty("--chip", chipColorFor(item.id));
      chip.setAttribute("aria-label", `Scan ${item.name}`);

      const name = document.createElement("span");
      name.className = "chip-name";
      name.textContent = item.name;

      const price = document.createElement("span");
      price.className = "chip-price";
      price.textContent = formatRinggit(item.priceSen);

      const tick = document.createElement("span");
      tick.className = "chip-tick";
      tick.textContent = "✓";
      tick.setAttribute("aria-hidden", "true");

      chip.append(name, price, tick);
      chip.addEventListener("click", () => this.onChipClick(index, chip));
      this.conveyorEl.appendChild(chip);
    });
  }

  private buildChangePad(): void {
    this.denomButtonsEl.innerHTML = "";
    for (const denom of DENOMS_SEN) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "denom-btn";
      button.textContent = DENOM_LABELS[denom] ?? formatRinggit(denom);
      button.addEventListener("click", (event) => {
        if (this.closed || !this.session) return;
        this.session = dispense(this.session, denom);
        (event.currentTarget as HTMLButtonElement).blur();
        this.render();
      });
      this.denomButtonsEl.appendChild(button);
    }
  }

  private wireButtons(): void {
    this.undoBtn.onclick = (event) => {
      if (this.closed || !this.session) return;
      this.session = undoDispense(this.session);
      (event.currentTarget as HTMLButtonElement).blur();
      this.render();
    };
    this.hintBtn.onclick = (event) => {
      if (this.closed) return;
      this.hintOpen = !this.hintOpen;
      (event.currentTarget as HTMLButtonElement).blur();
      this.renderHint();
    };
  }

  private onChipClick(index: number, chip: HTMLButtonElement): void {
    const session = this.session;
    if (this.closed || !session || session.phase !== "scanning") {
      return;
    }
    chip.blur();
    // The scanner sits at one spot — only the frontmost unscanned chip can be
    // scanned; tapping a later chip gets a friendly wobble instead.
    if (index === session.scanned) {
      this.scanFrontmost();
      return;
    }
    if (index > session.scanned) {
      chip.classList.remove("nope");
      void chip.offsetWidth; // restart the animation
      chip.classList.add("nope");
      if (this.nopeTimer !== null) window.clearTimeout(this.nopeTimer);
      this.nopeTimer = window.setTimeout(() => chip.classList.remove("nope"), NOPE_SHAKE_MS);
    }
  }

  private scanFrontmost(): void {
    const session = this.session;
    if (this.closed || !session || session.phase !== "scanning") {
      return;
    }
    this.session = scanNext(session);
    this.render();
  }

  // ---- Rendering ------------------------------------------------------------

  private render(): void {
    const session = this.session;
    const customer = this.customer;
    if (!session || !customer) return;
    const s = session;

    const tenderLabel = DENOM_LABELS[customer.tenderNoteSen] ?? formatRinggit(customer.tenderNoteSen);
    this.avatarEl.textContent = customer.name.charAt(0).toUpperCase();
    this.nameEl.textContent = customer.name;
    this.tenderEl.textContent = `${customer.name} pays with ${tenderLabel}`;

    this.renderChips();
    this.renderDisplay();
    this.renderChangePad();
    this.renderHint();

    // Once the last item is scanned the customer pays after a short beat.
    if (s.phase === "paying" && !this.paymentScheduled) {
      this.paymentScheduled = true;
      this.paymentTimer = window.setTimeout(() => {
        this.paymentTimer = null;
        if (this.closed || !this.session || this.session.phase !== "paying") {
          return;
        }
        this.session = receivePayment(this.session, customer.tenderNoteSen);
        this.render();
      }, PAY_BEAT_MS);
    }

    this.thankYouEl.hidden = s.phase !== "done";
    if (s.phase === "done" && !this.finishScheduled) {
      this.finishScheduled = true;
      this.finishTimer = window.setTimeout(() => {
        this.finishTimer = null;
        if (this.closed) {
          return;
        }
        this.closeTill(true);
      }, THANK_YOU_MS);
    }
  }

  private renderChips(): void {
    const session = this.session;
    if (!session) return;
    const chips = this.conveyorEl.children;
    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i] as HTMLButtonElement;
      const scanned = i < session.scanned;
      chip.classList.toggle("scanned", scanned);
      chip.classList.toggle(
        "next",
        session.phase === "scanning" && i === session.scanned,
      );
    }
  }

  private renderDisplay(): void {
    const session = this.session;
    const customer = this.customer;
    if (!session || !customer) return;
    const s = session;
    const itemCount = s.items.length;

    if (s.phase === "scanning") {
      this.lcdMainEl.textContent = `TOTAL ${formatRinggit(s.totalSen)}`;
      this.lcdSubEl.textContent =
        s.scanned === 0
          ? "Waiting for the first item…"
          : `✓ ${s.items[s.scanned - 1].name} — ${s.scanned}/${itemCount}`;
      this.lcdGivenEl.hidden = true;
      this.tooMuchEl.hidden = true;
      return;
    }

    if (s.phase === "paying") {
      this.lcdMainEl.textContent = `TOTAL ${formatRinggit(s.totalSen)}`;
      this.lcdSubEl.textContent = `${customer.name} is paying…`;
      this.lcdGivenEl.hidden = true;
      this.tooMuchEl.hidden = true;
      return;
    }

    const paid = s.tenderedSen !== null ? formatRinggit(s.tenderedSen) : "—";
    this.lcdMainEl.textContent =
      s.phase === "done"
        ? `Paid ${paid} — Terima kasih!`
        : `Paid ${paid} — Change due ${formatRinggit(s.changeDueSen)}`;
    this.tooMuchEl.hidden = !(s.givenSen > s.changeDueSen);

    if (s.phase === "change") {
      this.lcdSubEl.textContent = `${customer.name} is waiting patiently…`;
      this.lcdGivenEl.hidden = false;
      this.lcdGivenEl.textContent = `Given so far: ${formatRinggit(s.givenSen)}`;
      return;
    }

    // done — exact tender lands here straight from payment, or via the pad.
    this.lcdSubEl.textContent =
      s.tenderedSen !== null && s.changeDueSen === 0
        ? "Exact — no change needed."
        : "Thank you!";
    this.lcdGivenEl.hidden = true;
    this.tooMuchEl.hidden = true;
  }

  private renderChangePad(): void {
    const visible = this.session?.phase === "change";
    this.changePadEl.hidden = !visible;
    this.undoBtn.disabled = (this.session?.given.length ?? 0) === 0;
  }

  private renderHint(): void {
    const session = this.session;
    const visible = session?.phase === "change";
    this.hintBtn.hidden = !visible;
    if (!visible || !session) {
      this.hintTipEl.hidden = true;
      return;
    }
    if (!this.hintOpen) {
      this.hintTipEl.hidden = true;
      return;
    }
    try {
      // Opt-in only: the breakdown never shows on the main LCD, just here.
      // Reflect what is LEFT to give — after part of the change is handed
      // over, the full breakdown would overshoot. Nothing left (or already
      // overshot) gets the same "no hint" reply.
      const remaining = session.changeDueSen - session.givenSen;
      if (remaining <= 0) {
        this.hintTipEl.textContent = "No hint available for this change.";
        this.hintTipEl.hidden = false;
        return;
      }
      const parts = makeChange(remaining).map(
        (denom) => DENOM_LABELS[denom] ?? formatRinggit(denom),
      );
      this.hintTipEl.textContent = `Try: ${parts.join(" + ")}`;
    } catch {
      this.hintTipEl.textContent = "No hint available for this change.";
    }
    this.hintTipEl.hidden = false;
  }

  /**
   * Hide the overlay, drop the key listener and timers, and fire the close
   * callback exactly once. `completed` is true when the sale finished.
   */
  private closeTill(completed: boolean): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.clearTimers();
    window.removeEventListener("keydown", this.onKeyDown);

    this.root.hidden = true;
    this.hintTipEl.hidden = true;
    this.thankYouEl.hidden = true;

    this.closeHandler?.({ completed });
  }

  private clearTimers(): void {
    if (this.paymentTimer !== null) {
      window.clearTimeout(this.paymentTimer);
      this.paymentTimer = null;
    }
    if (this.finishTimer !== null) {
      window.clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }
    if (this.nopeTimer !== null) {
      window.clearTimeout(this.nopeTimer);
      this.nopeTimer = null;
    }
  }
}
