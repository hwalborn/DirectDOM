import type { FC } from "react";
import dibsCss from "dibs-css";

type Props = {
  dataTn: string;
};

export const SubmitButton: FC<Props> = ({ dataTn }) => (
  <button
    type="button"
    data-tn={`${dataTn}-submitButton`}
    className={dibsCss.buttonPrimary}
  >
    Submit
  </button>
);
