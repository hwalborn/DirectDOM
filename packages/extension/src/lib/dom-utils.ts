import type { ElementSnapshot, BoundingBox, DomPatch } from "@directdom/shared";
import {
  normalizeDibsCssClassNames,
  resolveClassNameConflicts,
} from "@directdom/shared";

const STYLE_KEYS = [
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "padding",
  "margin",
] as const;

const TEST_ID_ATTRIBUTES = ["data-tn", "data-testid"] as const;

const toKebabCase = (prop: string): string =>
  prop.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);

const parseInlineStyleAttr = (
  style: string | undefined,
): Map<string, string> => {
  const map = new Map<string, string>();
  if (!style) return map;

  for (const decl of style.split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim();
    const val = decl.slice(colon + 1).trim();
    if (prop) map.set(prop, val);
  }

  return map;
};

const applyInlineStyle = (
  element: HTMLElement,
  value: Record<string, string>,
  mode: "merge" | "replace",
): void => {
  if (mode === "replace") {
    element.style.cssText = "";
  }

  for (const [prop, val] of Object.entries(value)) {
    element.style.setProperty(toKebabCase(prop), val);
  }
};

const revertInlineStyle = (
  element: HTMLElement,
  before: ElementSnapshot,
  patch: { value: Record<string, string>; mode: "merge" | "replace" },
): void => {
  if (patch.mode === "replace") {
    const beforeStyle = before.attributes?.style;
    if (beforeStyle) {
      element.setAttribute("style", beforeStyle);
    } else {
      element.removeAttribute("style");
    }
    return;
  }

  const beforeStyles = parseInlineStyleAttr(before.attributes?.style);
  for (const prop of Object.keys(patch.value)) {
    const kebab = toKebabCase(prop);
    if (beforeStyles.has(kebab)) {
      element.style.setProperty(kebab, beforeStyles.get(kebab)!);
    } else {
      element.style.removeProperty(kebab);
    }
  }
};

export const getBoundingBox = (element: Element): BoundingBox => {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
};

const getComputedStyleSubset = (
  element: Element,
): ElementSnapshot["computedStyles"] => {
  const computed = window.getComputedStyle(element);
  const styles: NonNullable<ElementSnapshot["computedStyles"]> = {};
  for (const key of STYLE_KEYS) {
    styles[key] = computed[key as keyof CSSStyleDeclaration] as string;
  }
  return styles;
};

export const getElementSnapshot = (element: Element): ElementSnapshot => {
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    attributes[attr.name] = attr.value;
  }

  const htmlElement = element as HTMLElement;
  if (htmlElement.style?.cssText) {
    attributes.style = htmlElement.style.cssText;
  }

  const childTags = Array.from(element.children).map((child) =>
    child.tagName.toLowerCase(),
  );
  const parent = element.parentElement;

  return {
    tagName: element.tagName.toLowerCase(),
    textContent: element.textContent?.trim().slice(0, 500) ?? "",
    className: element.className?.toString() ?? "",
    attributes,
    computedStyles: getComputedStyleSubset(element),
    outerHTML: element.outerHTML.slice(0, 2000),
    innerHTML: element.innerHTML.slice(0, 1500),
    parentTagName: parent?.tagName.toLowerCase(),
    parentClassName: parent?.className?.toString().slice(0, 200) || undefined,
    childCount: element.children.length,
    childTagSummary:
      childTags.length > 0
        ? `${childTags.slice(0, 8).join(", ")}${childTags.length > 8 ? ` (+${childTags.length - 8} more)` : ""} (${childTags.length})`
        : undefined,
  };
};

/** Names that are React internals or host wrappers — not useful for source lookup. */
const isIgnoredFiberName = (name: string): boolean => {
  if (
    name === "Fragment" ||
    name === "Suspense" ||
    name === "StrictMode" ||
    name === "Profiler" ||
    name === "SuspenseList"
  ) {
    return true;
  }
  // Host components: div, span, button, …
  if (/^[a-z]/.test(name)) return true;
  if (/^(ForwardRef|Memo|Anonymous)\b/.test(name)) return true;
  return false;
};

const readFiberTypeName = (fiber: {
  type?: { displayName?: string; name?: string } | string;
  elementType?: { displayName?: string; name?: string } | string;
}): string | undefined => {
  const fromType = (type: typeof fiber.type): string | undefined => {
    if (!type) return undefined;
    if (typeof type === "string") return type;
    return type.displayName ?? type.name;
  };
  return fromType(fiber.type) ?? fromType(fiber.elementType);
};

/**
 * Innermost useful React composite component name for codegen lookup.
 * Returns a pipe-separated chain (nearest first), e.g. "ProductTitle|ProductDetails".
 */
export const getReactFiberHint = (element: Element): string | undefined => {
  const key = Object.keys(element).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return undefined;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fiber = (element as any)[key];
    const names: string[] = [];

    while (fiber && names.length < 6) {
      const name = readFiberTypeName(fiber);
      if (name && !isIgnoredFiberName(name) && !names.includes(name)) {
        names.push(name);
      }
      fiber = fiber.return;
    }

    return names.length > 0 ? names.join("|") : undefined;
  } catch {
    return undefined;
  }
};

export const generateSelector = (element: Element): string => {
  for (const attributeName of TEST_ID_ATTRIBUTES) {
    const testId = element.getAttribute(attributeName);
    if (testId) {
      return `[${attributeName}="${CSS.escape(testId)}"]`;
    }
  }

  const id = element.id;
  if (
    id &&
    !id.match(/^\d/) &&
    document.querySelectorAll(`#${CSS.escape(id)}`).length === 1
  ) {
    return `#${CSS.escape(id)}`;
  }

  const role = element.getAttribute("role");
  const ariaLabel = element.getAttribute("aria-label");
  if (role && ariaLabel) {
    const selector = `[role="${CSS.escape(role)}"][aria-label="${CSS.escape(ariaLabel)}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body) {
    let part = current.tagName.toLowerCase();
    if (
      current.id &&
      document.querySelectorAll(`#${CSS.escape(current.id)}`).length === 1
    ) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c): c is Element => c.tagName === current!.tagName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        part += `:nth-of-type(${index})`;
      }
    }
    parts.unshift(part);
    current = parent;
  }

  return parts.join(" > ");
};

export const generateXPath = (element: Element): string => {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }

  return `/${parts.join("/")}`;
};

export const resolveElement = (selector: string): Element | null => {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
};

const replaceFirstMeaningfulText = (root: Element, newText: string): void => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    const trimmed = node.textContent?.trim() ?? "";
    if (trimmed.length > 0) {
      node.textContent = node.textContent!.replace(trimmed, newText);
      return;
    }
    node = walker.nextNode();
  }
};

const applyLabelToElement = (element: Element, newLabel: string): void => {
  const candidates = element.querySelectorAll(
    '[aria-label], [role="combobox"], [role="button"], [role="listbox"], button, label, span',
  );

  for (const candidate of Array.from(candidates)) {
    const ariaLabel = candidate.getAttribute("aria-label");
    if (ariaLabel?.trim()) {
      candidate.setAttribute("aria-label", newLabel);
      if (candidate.textContent?.trim() === ariaLabel.trim()) {
        candidate.textContent = newLabel;
      }
      return;
    }

    const text = candidate.textContent?.trim();
    if (text && text.length > 0 && text.length < 120) {
      candidate.textContent = newLabel;
      return;
    }
  }

  replaceFirstMeaningfulText(element, newLabel);
};

const prepareCloneForInsert = (clone: Element): Element => {
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));

  for (const attributeName of TEST_ID_ATTRIBUTES) {
    const identifiedElements = [
      ...(clone.hasAttribute(attributeName) ? [clone] : []),
      ...clone.querySelectorAll(`[${attributeName}]`),
    ];
    identifiedElements.forEach((element) => {
      const testId = element.getAttribute(attributeName);
      if (testId) {
        element.setAttribute(
          attributeName,
          `${testId}-directdom-copy`,
        );
      }
    });
  }

  return clone;
};

const parseHtmlToElement = (html: string): Element | null => {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
};

export const insertElementRelativeTo = (
  reference: Element,
  patch: Extract<DomPatch, { type: "insertElement" }>,
): Element | null => {
  let newElement: Element | null = null;

  if (patch.mode === "html" && patch.html) {
    newElement = parseHtmlToElement(patch.html);
  } else {
    newElement = prepareCloneForInsert(reference.cloneNode(true) as Element);
    if (patch.textContent) {
      applyLabelToElement(newElement, patch.textContent);
    }
  }

  if (!newElement) return null;

  switch (patch.position) {
    case "before":
      reference.insertAdjacentElement("beforebegin", newElement);
      break;
    case "inside":
      reference.appendChild(newElement);
      break;
    case "after":
    default:
      reference.insertAdjacentElement("afterend", newElement);
      break;
  }

  return newElement;
};

export const applyPatchToElement = (
  element: Element,
  patch: DomPatch,
): void => {
  switch (patch.type) {
    case "textContent":
      element.textContent = patch.value;
      break;
    case "className": {
      const normalizedValue = normalizeDibsCssClassNames(patch.value);
      if (patch.mode === "merge") {
        element.className = resolveClassNameConflicts(
          element.className,
          normalizedValue,
        );
      } else {
        element.className = normalizedValue;
      }
      break;
    }
    case "inlineStyle":
      applyInlineStyle(element as HTMLElement, patch.value, patch.mode);
      break;
    case "attribute":
      if (patch.name.toLowerCase() === "style") {
        applyInlineStyle(
          element as HTMLElement,
          Object.fromEntries(parseInlineStyleAttr(patch.value)),
          "merge",
        );
      } else {
        element.setAttribute(patch.name, patch.value);
      }
      break;
    case "swapElement":
      if (patch.html) {
        const template = document.createElement("template");
        template.innerHTML = patch.html.trim();
        const newNode = template.content.firstElementChild;
        if (newNode) {
          element.replaceWith(newNode);
        }
      }
      break;
    case "insertElement":
      break;
  }
};

export const revertPatch = (
  element: Element,
  before: ElementSnapshot,
  patch: import("@directdom/shared").DomPatch,
): void => {
  switch (patch.type) {
    case "textContent":
      element.textContent = before.textContent ?? "";
      break;
    case "className": {
      if (patch.mode === "merge") {
        const toRemove = new Set(
          normalizeDibsCssClassNames(patch.value).split(/\s+/).filter(Boolean),
        );
        element.className = element.className
          .split(/\s+/)
          .filter((cls) => !toRemove.has(cls))
          .join(" ");
      } else {
        element.className = before.className ?? "";
      }
      break;
    }
    case "inlineStyle":
      revertInlineStyle(element as HTMLElement, before, patch);
      break;
    case "attribute":
      if (patch.name.toLowerCase() === "style") {
        revertInlineStyle(element as HTMLElement, before, {
          value: Object.fromEntries(parseInlineStyleAttr(patch.value)),
          mode: "merge",
        });
      } else if (before.attributes?.[patch.name] !== undefined) {
        element.setAttribute(patch.name, before.attributes[patch.name]);
      } else {
        element.removeAttribute(patch.name);
      }
      break;
    case "swapElement":
      if (before.outerHTML) {
        const template = document.createElement("template");
        template.innerHTML = before.outerHTML.trim();
        const newNode = template.content.firstElementChild;
        if (newNode) {
          element.replaceWith(newNode);
        }
      }
      break;
    case "insertElement":
      element.remove();
      break;
  }
};
