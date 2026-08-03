import type { ChangeRecord } from "@directdom/shared";
import {
  findOpeningTagEndLine,
  findTargetJsxStartLine,
} from "./jsx-source-location.js";

const formatJsxStyleValue = (value: string): string => {
  if (/^-?\d+(\.\d+)?(px|rem|em|%)?$/.test(value)) return value;
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
};

const formatStyleObjectLiteral = (
  declarations: Record<string, string>,
): string => {
  const props = Object.entries(declarations)
    .map(([key, value]) => `${key}: ${formatJsxStyleValue(value)}`)
    .join(", ");
  return `{ ${props} }`;
};

const mergeStyleLiteral = (
  existingLiteral: string,
  declarations: Record<string, string>,
): string => {
  const inner = existingLiteral.trim().replace(/^\{/, "").replace(/\}$/, "").trim();
  const newProps = Object.entries(declarations)
    .map(([key, value]) => `${key}: ${formatJsxStyleValue(value)}`)
    .join(", ");

  if (!inner) {
    return `{ ${newProps} }`;
  }

  const separator = inner.endsWith(",") ? " " : ", ";
  return `{ ${inner}${separator}${newProps} }`;
};

/**
 * Add or merge a literal style={{ ... }} prop on the JSX element that matches the change target.
 */
export const applyInlineStyleToJsxContent = (
  content: string,
  change: ChangeRecord,
  relativePath: string,
  declarations: Record<string, string>,
): { content: string; replacements: number } => {
  if (Object.keys(declarations).length === 0) {
    return { content, replacements: 0 };
  }

  const startLine = findTargetJsxStartLine(content, change, relativePath);
  if (startLine === null) return { content, replacements: 0 };

  const lines = content.split("\n");
  const openEndLine = findOpeningTagEndLine(lines, startLine);
  const openingLines = lines.slice(startLine, openEndLine + 1);
  const openingTag = openingLines.join("\n");
  const styleLiteralRe = /style=\{(\{[\s\S]*?\})\}/;
  const styleMatch = openingTag.match(styleLiteralRe);

  let newOpening: string;

  if (styleMatch?.[1]) {
    const merged = mergeStyleLiteral(styleMatch[1], declarations);
    newOpening = openingTag.replace(styleLiteralRe, `style={${merged}}`);
  } else {
    const styleAttr = ` style={${formatStyleObjectLiteral(declarations)}}`;

    if (openingLines.length === 1) {
      const line = openingLines[0];
      if (/\/>\s*$/.test(line.trim())) {
        newOpening = line.replace(/\/>\s*$/, `${styleAttr} />`);
      } else {
        newOpening = line.replace(/>$/, `${styleAttr}>`);
      }
    } else {
      const lastIdx = openingLines.length - 1;
      const lastLine = openingLines[lastIdx];
      const indent =
        openingLines[Math.max(0, lastIdx - 1)].match(/^(\s*)/)?.[1] ?? "  ";

      if (lastLine.trim() === ">") {
        const updatedLines = [...openingLines];
        updatedLines.splice(
          lastIdx,
          0,
          `${indent}style={${formatStyleObjectLiteral(declarations)}}`,
        );
        newOpening = updatedLines.join("\n");
      } else if (lastLine.includes(">")) {
        openingLines[lastIdx] = lastLine.replace(/>$/, `${styleAttr}>`);
        newOpening = openingLines.join("\n");
      } else {
        return { content, replacements: 0 };
      }
    }
  }

  if (newOpening === openingTag) return { content, replacements: 0 };

  const newLines = [
    ...lines.slice(0, startLine),
    ...newOpening.split("\n"),
    ...lines.slice(openEndLine + 1),
  ];

  return { content: newLines.join("\n"), replacements: 1 };
};
