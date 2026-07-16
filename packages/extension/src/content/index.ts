import type { ChangeRecord, DomPatch } from "@directdom/shared";
import { ChangeRecordSchema } from "@directdom/shared";
import {
  applyPatchToElement,
  generateSelector,
  generateXPath,
  getBoundingBox,
  getElementSnapshot,
  getReactFiberHint,
  insertElementRelativeTo,
  resolveElement,
  revertPatch,
} from "../lib/dom-utils";
import type { ExtensionMessage } from "../lib/messaging";
import { safeRuntimeSend } from "../lib/messaging";

let pickerActive = false;
let highlightOverlay: HTMLDivElement | null = null;
let lastSelectedSelector: string | null = null;
const ledger: ChangeRecord[] = [];

const createHighlightOverlay = (): HTMLDivElement => {
  const overlay = document.createElement("div");
  overlay.id = "directdom-highlight";
  overlay.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483646;
    border: 2px solid #6366f1;
    background: rgba(99, 102, 241, 0.12);
    border-radius: 4px;
    transition: all 0.1s ease;
  `;
  document.body.appendChild(overlay);
  return overlay;
};

const updateHighlight = (element: Element): void => {
  if (!highlightOverlay) {
    highlightOverlay = createHighlightOverlay();
  }
  const rect = element.getBoundingClientRect();
  highlightOverlay.style.top = `${rect.top}px`;
  highlightOverlay.style.left = `${rect.left}px`;
  highlightOverlay.style.width = `${rect.width}px`;
  highlightOverlay.style.height = `${rect.height}px`;
  highlightOverlay.style.display = "block";
};

const hideHighlight = (): void => {
  if (highlightOverlay) {
    highlightOverlay.style.display = "none";
  }
};

const handlePickerMove = (event: MouseEvent): void => {
  if (!pickerActive) return;
  event.preventDefault();
  event.stopPropagation();
  const element = document.elementFromPoint(event.clientX, event.clientY);
  if (element && !element.closest("#directdom-highlight")) {
    updateHighlight(element);
  }
};

const handlePickerClick = (event: MouseEvent): void => {
  if (!pickerActive) return;
  event.preventDefault();
  event.stopPropagation();

  const element = document.elementFromPoint(event.clientX, event.clientY);
  if (!element || element.closest("#directdom-highlight")) return;

  pickerActive = false;
  document.removeEventListener("mousemove", handlePickerMove, true);
  document.removeEventListener("click", handlePickerClick, true);
  hideHighlight();

  const selector = generateSelector(element);
  const snapshot = getElementSnapshot(element);

  safeRuntimeSend({
    type: "ELEMENT_SELECTED",
    selector,
    snapshot,
    xpath: generateXPath(element),
    reactFiberHint: getReactFiberHint(element),
    boundingBox: getBoundingBox(element),
  });

  lastSelectedSelector = selector;
};

const startPicker = (): void => {
  pickerActive = true;
  document.addEventListener("mousemove", handlePickerMove, true);
  document.addEventListener("click", handlePickerClick, true);
};

const stopPicker = (): void => {
  pickerActive = false;
  document.removeEventListener("mousemove", handlePickerMove, true);
  document.removeEventListener("click", handlePickerClick, true);
  hideHighlight();
};

const applyPatch = (
  patch: DomPatch,
  intent: string,
  selector?: string,
): ChangeRecord | null => {
  const targetSelector = selector ?? lastSelectedSelector;
  if (!targetSelector) return null;

  const element = resolveElement(targetSelector);
  if (!element) return null;

  if (patch.type === "insertElement") {
    const before = getElementSnapshot(element);
    const inserted = insertElementRelativeTo(element, patch);
    if (!inserted) return null;

    const insertedSelector = generateSelector(inserted);
    const after = getElementSnapshot(inserted);

    const record: ChangeRecord = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      intent,
      target: {
        selector: insertedSelector,
        xpath: generateXPath(inserted),
        reactFiberHint: getReactFiberHint(inserted),
        boundingBox: getBoundingBox(inserted),
      },
      before,
      after,
      patch,
      confidence: "high",
    };

    ChangeRecordSchema.parse(record);
    if (!ledger.some((entry) => entry.id === record.id)) {
      ledger.push(record);
    }
    lastSelectedSelector = insertedSelector;

    safeRuntimeSend({
      type: "LEDGER_UPDATE",
      ledger: [...ledger],
    });

    return record;
  }

  const before = getElementSnapshot(element);
  applyPatchToElement(element, patch);

  const afterElement = resolveElement(targetSelector) ?? element;
  const after = getElementSnapshot(afterElement);

  const record: ChangeRecord = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    intent,
    target: {
      selector: targetSelector,
      xpath: generateXPath(afterElement),
      reactFiberHint: getReactFiberHint(afterElement),
      boundingBox: getBoundingBox(afterElement),
    },
    before,
    after,
    patch,
    confidence: "high",
  };

  ChangeRecordSchema.parse(record);
  if (!ledger.some((entry) => entry.id === record.id)) {
    ledger.push(record);
  }
  lastSelectedSelector = targetSelector;

  safeRuntimeSend({
    type: "LEDGER_UPDATE",
    ledger: [...ledger],
  });

  return record;
};

const undoChange = (changeId: string): boolean => {
  const index = ledger.findIndex((r) => r.id === changeId);
  if (index === -1) return false;

  const record = ledger[index];
  const element = resolveElement(record.target.selector);
  if (!element) return false;

  revertPatch(element, record.before, record.patch);
  ledger.splice(index, 1);

  safeRuntimeSend({
    type: "LEDGER_UPDATE",
    ledger: [...ledger],
  });

  return true;
};

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    switch (message.type) {
      case "START_PICKER":
        startPicker();
        sendResponse({ ok: true });
        break;
      case "STOP_PICKER":
        stopPicker();
        sendResponse({ ok: true });
        break;
      case "APPLY_PATCH":
        if (message.patch && message.intent) {
          const msg = message as ExtensionMessage & { selector?: string };
          const record = applyPatch(
            message.patch as DomPatch,
            message.intent,
            msg.selector,
          );
          sendResponse({ changeRecord: record });
        }
        break;
      case "UNDO_CHANGE":
        sendResponse({ ok: undoChange(message.changeId) });
        break;
      case "GET_LEDGER":
        sendResponse({ ledger: [...ledger] });
        break;
      default:
        break;
    }
    return true;
  },
);

console.info("[DirectDOM] Content script loaded");
