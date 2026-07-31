import classnames from "classnames";
import dibsCss from "dibs-css";

type Props = {
  title: string;
};

export const ProductTitleLowercase = ({ title }: Props) => (
  <h2
    data-tn="product-title-lowercase"
    className={classnames(dibsCss.truncate)}
  >
    {title}
  </h2>
);
