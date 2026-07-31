import classNames from "classnames";
import styles from "./ProductTitle.module.css";
import dibsCss from "dibs-css";

type ProductTitleProps = {
  title: string;
};

export const ProductTitleWithModule = ({ title }: ProductTitleProps) => (
  <h2
    className={classNames(styles.title, dibsCss.truncate)}
    data-tn="product-title-module"
  >
    {title}
  </h2>
);
