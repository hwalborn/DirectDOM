import type { FC } from "react";
import classNames from "classnames";
import dibsCss from "dibs-css";

type Props = {
  title: string;
};

export const ProductTitle: FC<Props> = ({ title }) => (
  <h2
    data-tn="product-title"
    className={classNames(dibsCss.textSatan, dibsCss.truncate)}
  >
    Vintage chair
  </h2>
);
