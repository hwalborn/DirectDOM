import type { FC } from "react";
import dibsCss from "dibs-css";

export const UnrelatedWidget: FC = () => (
  <div className={dibsCss.flex} data-tn="unrelated-widget">
    Something else
  </div>
);
