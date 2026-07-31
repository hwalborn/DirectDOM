import { describe, expect, it } from "vitest";
import {
  buildClassNamesCallRe,
  detectComponentStyleContext,
} from "./component-style-context.js";

describe("detectComponentStyleContext", () => {
  it("detects the local binding for import ... from \"classnames\"", () => {
    const camelCase = detectComponentStyleContext("", "Foo.tsx", `
import classNames from "classnames";
import dibsCss from "dibs-css";
`);
    expect(camelCase.classNamesAlias).toBe("classNames");

    const lowercase = detectComponentStyleContext("", "Foo.tsx", `
import classnames from "classnames";
`);
    expect(lowercase.classNamesAlias).toBe("classnames");

    const custom = detectComponentStyleContext("", "Foo.tsx", `
import cn from "classnames";
`);
    expect(custom.classNamesAlias).toBe("cn");
  });
});

describe("buildClassNamesCallRe", () => {
  it("matches the import alias case-sensitively", () => {
    const source = `className={classnames(dibsCss.truncate, styles.title)}`;

    expect(source.match(buildClassNamesCallRe("classnames"))?.[1]).toBe(
      "dibsCss.truncate, styles.title",
    );
    expect(source.match(buildClassNamesCallRe("classNames"))).toBeNull();
  });
});
