import type { FC } from "react";
import dibsCss from "dibs-css";

export const ActionRequiredBanner: FC = () => (
  <h2 className={dibsCss.textAlert} data-tn="action-required-heading">
    Action Required
  </h2>
);
