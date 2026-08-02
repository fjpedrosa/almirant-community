"use client";

import { ImageOff } from "lucide-react";
import type { ResultProduct } from "../../application/utils/read-result-products";

interface ProductCardProps {
  product: ResultProduct;
}

const formatPrice = (price: number, currency?: string): string =>
  currency
    ? new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(price)
    : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(price);

/**
 * One product from a validated catalogue.
 *
 * Every field except the name is optional and simply absent when missing — a
 * card must never print "undefined AUD". `Intl` needs a currency code to format
 * one, so a price without a currency shows as a bare number rather than being
 * dropped: the figure is the useful part.
 */
export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const body = (
    <>
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted/50">
        {product.image ? (
          // Remote store CDNs are not in the Next image allowlist, and adding
          // every customer's domain is not a thing we want to maintain.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <ImageOff className="size-6 text-muted-foreground/40" />
        )}
      </div>
      <div className="mt-2 space-y-0.5">
        <p className="line-clamp-2 text-sm font-medium text-foreground">
          {product.name}
        </p>
        <div className="flex items-center gap-2">
          {product.price !== undefined && (
            <span className="text-sm text-foreground/80">
              {formatPrice(product.price, product.currency)}
            </span>
          )}
          {product.inStock === false && (
            <span className="text-xs text-muted-foreground">agotado</span>
          )}
        </div>
        {product.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {product.description}
          </p>
        )}
      </div>
    </>
  );

  const className =
    "block rounded-lg border border-border/60 bg-card p-2 transition-colors";

  return product.url ? (
    <a
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${className} hover:border-primary/40 hover:bg-muted/30`}
    >
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
};
