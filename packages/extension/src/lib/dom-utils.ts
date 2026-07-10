import type { ElementSnapshot, BoundingBox } from "@directdom/shared";
import { normalizeDibsCssClassNames } from "@directdom/shared";

const STYLE_KEYS = [
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "padding",
  "margin",
] as const;

export const getBoundingBox = (element: Element): BoundingBox => {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
};

export const getComputedStyleSubset = (
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

  return {
    tagName: element.tagName.toLowerCase(),
    textContent: element.textContent?.trim().slice(0, 500) ?? "",
    className: element.className?.toString() ?? "",
    attributes,
    computedStyles: getComputedStyleSubset(element),
    outerHTML: element.outerHTML.slice(0, 2000),
  };
};

/** Lightweight "what React component is this?" hint for selected/changed elements,
 *  used to enrich metadata for downstream tooling like codegen or Figma mapping. */
export const getReactFiberHint = (element: Element): string | undefined => {
  const key = Object.keys(element).find((k) =>
    k.startsWith("__reactFiber$"),
  );
  if (!key) return undefined;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fiber = (element as any)[key];
    while (fiber) {
      const name =
        fiber.type?.displayName ??
        fiber.type?.name ??
        fiber.elementType?.displayName ??
        fiber.elementType?.name;
      if (name && name !== "Fragment") {
        return name;
      }
      fiber = fiber.return;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

export const generateSelector = (element: Element): string => {
  const testId = element.getAttribute("data-testid");
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }

  const id = element.id;
  if (id && !id.match(/^\d/) && document.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
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
    if (current.id && document.querySelectorAll(`#${CSS.escape(current.id)}`).length === 1) {
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

export const applyPatchToElement = (
  element: Element,
  patch: import("@directdom/shared").DomPatch,
): void => {
  switch (patch.type) {
    case "textContent":
      element.textContent = patch.value;
      break;
    case "className": {
      const normalizedValue = normalizeDibsCssClassNames(patch.value);
      if (patch.mode === "merge") {
        const existing = new Set(
          element.className.split(/\s+/).filter(Boolean),
        );
        normalizedValue.split(/\s+/).forEach((c) => existing.add(c));
        element.className = Array.from(existing).join(" ");
      } else {
        element.className = normalizedValue;
      }
      break;
    }
    case "attribute":
      element.setAttribute(patch.name, patch.value);
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
    case "className":
      element.className = before.className ?? "";
      break;
    case "attribute":
      if (before.attributes?.[patch.name] !== undefined) {
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
  }
};
